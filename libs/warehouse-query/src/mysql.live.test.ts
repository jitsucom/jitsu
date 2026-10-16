import { afterEach, describe, expect, it } from "vitest";
import { createMySqlReader } from "./mysql";
import { ModelDefinition } from "./schema";
import type { WarehouseReader, SourceRecord } from "./types";

// Read-only queries; optional collation fixtures are seeded separately in disposable CI MySQL.
describe.skipIf(!process.env.TEST_RETL_MYSQL)("MySQL live reader", () => {
  const readers: WarehouseReader[] = [];
  const reader = () => {
    const r = createMySqlReader(JSON.parse(process.env.TEST_RETL_MYSQL!));
    readers.push(r);
    return r;
  };
  afterEach(async () => {
    await Promise.all(readers.splice(0).map(r => r.close()));
  });
  const model = (query: string, extra = {}) =>
    ModelDefinition.parse({ warehouseId: "live", query, primaryKey: ["id"], ...extra });
  async function collect(r: WarehouseReader, m: ModelDefinition, after?: Parameters<WarehouseReader["stream"]>[1]) {
    const rows: SourceRecord[] = [];
    for await (const row of r.stream(m, after)) rows.push(row);
    return rows;
  }
  it.skipIf(!process.env.TEST_RETL_MYSQL_COLLATION_FIXTURE)(
    "resumes table-backed text checkpoints using each source column's collation",
    async () => {
      const r = reader();
      const query = "SELECT id, binary_id, latin_id, sequence_id, updated FROM checkpoint_collations";
      for (const [key, expected] of [
        ["id", ["a", "é", "z"]],
        ["binary_id", ["Z", "a", "z"]],
        ["latin_id", ["a", "é", "z"]],
      ] as const) {
        for (const cursor of [
          { column: key, type: "string" },
          { column: "sequence_id", type: "number" },
          { column: "updated", type: "timestamp" },
        ]) {
          const m = model(query, { primaryKey: [key], cursor });
          const initial = await collect(r, m);
          expect(initial.map(record => record.row[key])).toEqual(expected);
          for (let i = 0; i < initial.length; i++) {
            expect(await collect(r, m, initial[i].checkpoint)).toEqual(initial.slice(i + 1));
          }
        }
      }
    }
  );
  it("preserves unsigned bigint, decimal(65,0), JSON numbers and timestamp microseconds", async () => {
    const r = reader();
    const huge = "9".repeat(65);
    const query = `SELECT CAST('18446744073709551615' AS UNSIGNED) AS id, CAST('${huge}' AS DECIMAL(65,0)) AS amount,
      CAST('2026-01-01 12:34:56.123456' AS DATETIME(6)) AS updated, CAST('{"id":9007199254740993}' AS JSON) AS payload`;
    const preview = await r.preview(query);
    expect(preview.rows[0]).toMatchObject({
      id: "18446744073709551615",
      amount: huge,
      updated: "2026-01-01 12:34:56.123456",
    });
    expect(preview.rows[0].payload).toContain("9007199254740993");
    expect((await collect(r, model(query)))[0].row).toEqual(preview.rows[0]);
  });
  it("resumes tied cursors with exact bindings, literal question marks and tombstones", async () => {
    const r = reader();
    const query = `SELECT 'a' AS id, CAST('9007199254740993' AS DECIMAL(20,0)) AS updated, 0 AS deleted, '?' AS literal_value
      UNION ALL SELECT 'b', CAST('9007199254740993' AS DECIMAL(20,0)), 1, '?'`;
    const m = model(query, { cursor: { column: "updated", type: "number" }, deleteColumn: "deleted" });
    r.sql.validateColumns(m, await r.columns(query));
    const rows = await collect(r, m, { value: "9007199254740993", primaryKeyValues: ["a"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      row: { id: "b", literal_value: "?" },
      deleted: true,
      checkpoint: { value: "9007199254740993", primaryKeyValues: ["b"] },
    });
    expect(await collect(r, m, rows[0].checkpoint)).toEqual([]);
  });
  it("preserves decimal fractions and timestamp precision when binding lookback and cursors", async () => {
    const r = reader();
    const query = `SELECT 'a' AS id, CAST('2026-01-01 00:00:00.123456' AS DATETIME(6)) AS updated
      UNION ALL SELECT 'b', CAST('2026-01-01 00:00:00.123457' AS DATETIME(6))`;
    const m = model(query, { cursor: { column: "updated", type: "timestamp" } });
    expect(
      (await collect(r, m, { value: "2026-01-01 00:00:00.123456", primaryKeyValues: ["a"] })).map(r => r.row.id)
    ).toEqual(["b"]);
    expect(
      await collect(
        r,
        { ...m, cursor: { column: "updated", type: "timestamp", lookbackSeconds: 1 } },
        { value: "2026-01-01 00:00:01.123456", primaryKeyValues: ["a"] }
      )
    ).toHaveLength(2);
    const decimal = model(
      "SELECT 'a' AS id, CAST('123456789012345678901234567890.12345678901234567890' AS DECIMAL(50,20)) AS updated",
      { cursor: { column: "updated", type: "number" } }
    );
    const all = await collect(r, decimal);
    expect(all[0].checkpoint?.value).toBe("123456789012345678901234567890.12345678901234567890");
    expect(await collect(r, decimal, all[0].checkpoint)).toEqual([]);
  });
  it("rejects duplicate identities before checkpoint filtering, null keys and invalid tombstones", async () => {
    const r = reader();
    await expect(
      collect(
        r,
        model("SELECT 'a' AS id, 1 AS updated UNION ALL SELECT 'a', 2", {
          cursor: { column: "updated", type: "number" },
        }),
        { value: "1", primaryKeyValues: ["a"] }
      )
    ).rejects.toThrow(/duplicate primary keys/);
    await expect(collect(r, model("SELECT CAST(NULL AS CHAR) AS id"))).rejects.toThrow(/non-null/);
    await expect(collect(r, model("SELECT 'a' AS id, 7 AS deleted", { deleteColumn: "deleted" }))).rejects.toThrow(
      /0\/1/
    );
  });
  it("decodes exact decimal tombstones without changing source payloads", async () => {
    const r = reader();
    const query = "SELECT 'a' AS id, CAST('0.00' AS DECIMAL(10,2)) AS deleted UNION ALL SELECT 'b', 1.00";
    const rows = await collect(r, model(query, { deleteColumn: "deleted" }));
    expect(rows.map(record => [record.row.deleted, record.deleted])).toEqual([
      ["0.00", false],
      ["1.00", true],
    ]);
    for (const deleted of ["CAST('1.01' AS DECIMAL(10,2))", "'1.00'"]) {
      await expect(
        collect(r, model(`SELECT 'a' AS id, ${deleted} AS deleted`, { deleteColumn: "deleted" }))
      ).rejects.toThrow(/0\/1/);
    }
  });
  it("bounds previews and permits empty full-query extraction", async () => {
    const r = reader();
    const query = Array.from({ length: 102 }, (_, i) => `SELECT ${i} AS id`).join(" UNION ALL ");
    const result = await r.preview(query);
    expect(result.rows).toHaveLength(100);
    expect(result.truncated).toBe(true);
    expect(await collect(r, model("SELECT 'a' AS id WHERE 1=0"))).toEqual([]);
  });
  it("cancels an outstanding server query", async () => {
    const r = reader();
    const pending = r.preview("SELECT SLEEP(10) AS id", AbortSignal.timeout(200));
    await expect(pending).rejects.toThrow();
  });
  it("preserves comments and backtick identifiers when binding resumed checkpoints", async () => {
    const r = reader();
    const query =
      "SELECT 'a' AS `id:source`, 1--1 AS updated, ':jitsu_checkpoint_0 ?' AS text_value /* source:prod ? */;";
    expect((await r.preview(query)).rows[0]).toMatchObject({ "id:source": "a", updated: 2 });
    const m = model(query, { primaryKey: ["id:source"], cursor: { column: "updated", type: "number" } });
    const records = await collect(r, m, { value: "1", primaryKeyValues: ["prior"] });
    expect(records).toHaveLength(1);
    expect(records[0].row.text_value).toBe(":jitsu_checkpoint_0 ?");
    expect(await collect(r, m, records[0].checkpoint)).toEqual([]);
  });
});
