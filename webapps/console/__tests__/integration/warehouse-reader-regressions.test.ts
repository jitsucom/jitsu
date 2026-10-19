import { afterAll, expect, it } from "vitest";
import { createWarehouseReader, type SourceRecord } from "@jitsu/warehouse-query";
import { ModelDefinition } from "@jitsu/warehouse-query/src/schema";
import { getServerEnv } from "../../lib/server/serverEnv";
import { deps } from "./support/harness";

const env = getServerEnv();
const pgUrl = new URL(env.DATABASE_URL);
const chUrl = new URL(env.CLICKHOUSE_URL!);
const pg = createWarehouseReader({
  destinationType: "postgres",
  host: pgUrl.hostname,
  port: Number(pgUrl.port),
  database: pgUrl.pathname.slice(1),
  username: pgUrl.username,
  password: pgUrl.password,
  sslMode: "disable",
});
const ch = createWarehouseReader({
  destinationType: "clickhouse",
  protocol: "http",
  hosts: [chUrl.host],
  database: env.CLICKHOUSE_DATABASE,
  username: "default",
  password: "",
});
afterAll(async () => {
  await Promise.all([pg.close(), ch.close()]);
});
const model = (query: string, extra = {}) =>
  ModelDefinition.parse({ warehouseId: "test", query, primaryKey: ["id"], ...extra });
async function collect(source: AsyncIterable<SourceRecord>) {
  const result: SourceRecord[] = [];
  for await (const row of source) result.push(row);
  return result;
}

it.each([
  ["PostgreSQL", pg, "SELECT 1 AS id, 0.00::numeric AS removed UNION ALL SELECT 2, 1.00::numeric"],
  ["ClickHouse", ch, "SELECT 1 AS id, toDecimal64('0.00', 2) AS removed UNION ALL SELECT 2, toDecimal64('1.00', 2)"],
] as const)("%s handles decimal delete flags without rewriting payloads or checkpoints", async (_, reader, query) => {
  const m = model(query, { deleteColumn: "removed", cursor: { column: "removed", type: "number" } });
  const rows = await collect(reader.stream(m));
  expect(rows.map(row => row.deleted)).toEqual([false, true]);
  const preview = await reader.preview(query);
  expect(rows.map(row => row.row.removed)).toEqual(preview.rows.map(row => row.removed));
  expect(rows[1].checkpoint?.value).toBe(String(preview.rows[1].removed));
  expect(await collect(reader.stream(m, rows[0].checkpoint))).toEqual(rows.slice(1));
});
it.each([
  ["PostgreSQL", pg, "1.01::numeric"],
  ["PostgreSQL text", pg, "'1.00'::text"],
  ["ClickHouse", ch, "toDecimal64('1.01', 2)"],
  ["ClickHouse text", ch, "'1.00'"],
] as const)("%s rejects invalid or textual decimal delete flags", async (_, reader, expression) => {
  await expect(
    collect(reader.stream(model(`SELECT 1 AS id, ${expression} AS removed`, { deleteColumn: "removed" })))
  ).rejects.toThrow(/0\/1/);
});

it("PostgreSQL preserves numeric and timestamp array precision and SQL nulls", async () => {
  const query = `SELECT 1 AS id, ARRAY[12345678901234567890.123456789::numeric, NULL] AS numbers,
    ARRAY['2026-01-01 00:00:00.123456'::timestamp, NULL] AS times,
    ARRAY['2026-01-01'::date, NULL] AS dates`;
  const preview = await pg.preview(query);
  expect(preview.rows[0]).toEqual({
    id: 1,
    numbers: ["12345678901234567890.123456789", null],
    times: ["2026-01-01 00:00:00.123456", null],
    dates: ["2026-01-01", null],
  });
  expect((await collect(pg.stream(model(query))))[0].row).toEqual(preview.rows[0]);
});

it("ClickHouse keeps JSON objects and arrays native without parsing ordinary text", async () => {
  const query = `SELECT 1 AS id, CAST('{"name":"Alice","items":[1,2]}' AS JSON) AS payload,
    '{"name":"Alice"}' AS text_value, array(1,2) AS items`;
  const preview = await ch.preview(query);
  expect(preview.rows[0]).toEqual({
    id: 1,
    payload: { name: "Alice", items: ["1", "2"] },
    text_value: '{"name":"Alice"}',
    items: [1, 2],
  });
  expect((await collect(ch.stream(model(query))))[0].row).toEqual(preview.rows[0]);
});

it.each(["json", "jsonb"])("PostgreSQL rejects overflowing %s numbers before preview or delivery", async type => {
  const query = `SELECT 1 AS id, '{"private":"sensitive","amount":1e400}'::${type} AS payload`;
  const error =
    /^Warehouse JSON contains a number outside JavaScript's finite range; return it as a JSON string instead$/;
  await expect(pg.preview(query)).rejects.toThrow(error);
  await expect(collect(pg.stream(model(query)))).rejects.toThrow(error);
});

it.each(["json", "jsonb"])("PostgreSQL decodes %s to native values in preview and extraction", async type => {
  const query = `SELECT 1 AS id,
    '{"id":9007199254740993,"amount":1.234567890123456789}'::${type} AS payload,
    '[9007199254740993,1.234567890123456789]'::${type} AS items,
    'null'::${type} AS json_null, NULL::${type} AS sql_null,
    'true'::${type} AS enabled, '"hello"'::${type} AS message, '{"x":1}'::text AS text_value,
    ARRAY[ARRAY['[9007199254740993]'::${type}, 'null'::${type}], ARRAY[NULL::${type}, 'true'::${type}]] AS nested`;
  const preview = await pg.preview(query);
  const row = preview.rows[0];
  expect(row.payload).toEqual({ id: 9007199254740992, amount: 1.2345678901234567 });
  expect(row.items).toEqual([9007199254740992, 1.2345678901234567]);
  expect(row).toMatchObject({
    json_null: null,
    sql_null: null,
    enabled: true,
    message: "hello",
    text_value: '{"x":1}',
    nested: [
      [[9007199254740992], null],
      [null, true],
    ],
  });
  expect((await collect(pg.stream(model(query))))[0].row).toEqual(row);
});

it.each([
  ["DateTime('America/New_York')", ""],
  ["DateTime64(6, 'America/New_York')", ".123456"],
  ["Nullable(DateTime64(9, 'America/New_York'))", ".123456789"],
  ["DateTime64(9)", ".123456789"],
])("ClickHouse preserves and resumes exact instants for %s", async (type, fraction) => {
  // The two instants have the same local wall time during New York's DST fallback.
  const table =
    "dst_checkpoints_" +
    (fraction.length || "seconds") +
    (type.startsWith("Nullable") ? "_nullable" : "_plain") +
    (type.includes("New_York") ? "_tz" : "");
  await deps().clickhouse.command({ query: `CREATE TABLE ${table} (id UInt64, changed ${type}) ENGINE = Memory` });
  await deps().clickhouse.command({
    query: `INSERT INTO ${table} SELECT 1, fromUnixTimestamp64Nano(1762061400123456789) UNION ALL SELECT 2, fromUnixTimestamp64Nano(1762065000123456789)`,
  });
  const query = `SELECT id, changed FROM ${table}`;
  const expected = [`2025-11-02T05:30:00${fraction}Z`, `2025-11-02T06:30:00${fraction}Z`];
  expect((await ch.preview(`${query} ORDER BY id`)).rows.map(row => row.changed)).toEqual(expected);
  for (const primaryKey of [["id"], ["changed", "id"]]) {
    const m = model(query, { primaryKey, cursor: { column: "changed", type: "timestamp" } });
    const rows = await collect(ch.stream(m));
    expect(rows.map(row => row.row.changed)).toEqual(expected);
    expect(await collect(ch.stream(m, rows[0].checkpoint))).toEqual(rows.slice(1));
    expect(await collect(ch.stream(m, rows[1].checkpoint))).toEqual([]);
    expect(
      await collect(ch.stream({ ...m, cursor: { ...m.cursor!, lookbackSeconds: 0 } }, rows[1].checkpoint))
    ).toEqual(rows.slice(1));
  }
});

it("ClickHouse leaves date-only and explicitly formatted string values unchanged", async () => {
  const query = "SELECT 1 AS id, toDate('2025-09-09') AS day, '2025-09-09 23:48:47.000000' AS formatted";
  const expected = { id: 1, day: "2025-09-09", formatted: "2025-09-09 23:48:47.000000" };
  expect((await ch.preview(query)).rows[0]).toEqual(expected);
  expect((await collect(ch.stream(model(query))))[0].row).toEqual(expected);
});

it.each([
  ["micros", "DateTime64(6, 'UTC')", 6],
  ["nanos", "Nullable(DateTime64(9, 'America/New_York'))", 9],
  ["millis", "DateTime64(3)", 3],
] as const)("ClickHouse resumes %s checkpoints before and across the Unix epoch", async (name, type, precision) => {
  const table = `epoch_checkpoints_${name}`;
  await deps().clickhouse.command({ query: `CREATE TABLE ${table} (id UInt64, changed ${type}) ENGINE = Memory` });
  // Include both sides of epoch zero, the smallest representable negative fraction,
  // and equal timestamps with distinct primary keys to exercise the tie-breaker.
  const tick = 10 ** (9 - precision);
  await deps().clickhouse.command({
    query: `INSERT INTO ${table}
      SELECT 1, fromUnixTimestamp64Nano(-500000000) UNION ALL
      SELECT 2, fromUnixTimestamp64Nano(-500000000) UNION ALL
      SELECT 3, fromUnixTimestamp64Nano(-${tick}) UNION ALL
      SELECT 4, fromUnixTimestamp64Nano(0) UNION ALL
      SELECT 5, fromUnixTimestamp64Nano(500000000)`,
  });
  const query = `SELECT id, changed FROM ${table}`;
  const half = "5".padEnd(precision, "0");
  const expected = [
    `1969-12-31T23:59:59.${half}Z`,
    `1969-12-31T23:59:59.${half}Z`,
    `1969-12-31T23:59:59.${"9".repeat(precision)}Z`,
    `1970-01-01T00:00:00.${"0".repeat(precision)}Z`,
    `1970-01-01T00:00:00.${half}Z`,
  ];
  expect((await ch.preview(`${query} ORDER BY id`)).rows.map(row => row.changed)).toEqual(expected);
  for (const primaryKey of [["id"], ["changed", "id"]]) {
    const m = model(query, { primaryKey, cursor: { column: "changed", type: "timestamp" } });
    const rows = await collect(ch.stream(m));
    expect(rows.map(row => row.row.changed)).toEqual(expected);
    for (let index = 0; index < rows.length; index++)
      expect(await collect(ch.stream(m, rows[index].checkpoint))).toEqual(rows.slice(index + 1));
    expect(
      await collect(ch.stream({ ...m, cursor: { ...m.cursor!, lookbackSeconds: 0 } }, rows[0].checkpoint))
    ).toEqual(rows);
  }
});
it.each(["nan", "inf", "-inf"])("ClickHouse does not silently treat %s delete flags as SQL null", async value => {
  const query = `SELECT 1 AS id, toFloat64('${value}') AS removed`;
  expect((await ch.preview(query)).rows[0].removed).toBe(value);
  await expect(collect(ch.stream(model(query, { deleteColumn: "removed" })))).rejects.toThrow(/0\/1/);
  await expect(collect(ch.stream(model(query, { primaryKey: ["removed"] })))).rejects.toThrow(/finite values/);
  await expect(collect(ch.stream(model(query, { cursor: { column: "removed", type: "number" } })))).rejects.toThrow(
    /finite values/
  );
});
