import { describe, expect, it } from "vitest";
import { ModelDefinition } from "./schema";
import type { WarehouseSqlDialect } from "./types";

/** Shared conformance suite, invoked by each warehouse's dialect tests. */
export function readerDialectContract(
  name: string,
  dialect: WarehouseSqlDialect,
  types: { key: string; number: string; timestamp: string; structured: string }
) {
  describe(`${name} reader contract`, () => {
    const model = ModelDefinition.parse({
      warehouseId: "wh",
      query: "SELECT id, updated, deleted FROM source",
      primaryKey: ["id"],
      cursor: { column: "updated", type: "number" },
    });
    const columns = [
      { name: "id", type: types.key },
      { name: "updated", type: types.number },
      { name: "deleted", type: types.number },
    ];
    it.each(["DELETE FROM source", "SELECT 1; SELECT 2", "UPDATE source SET id=1", "DROP TABLE source"])(
      "rejects %s",
      sql => {
        expect(() => dialect.validateQuery(sql)).toThrow();
      }
    );
    it("preserves SQL literals while removing statement delimiters", () => {
      expect(dialect.validateQuery("SELECT 'a;b' AS id;")).toContain("'a;b'");
      expect(dialect.validateQuery("SELECT 1 AS id;").trim().endsWith(";")).toBe(false);
    });
    it("validates every key, cursor and tombstone before querying", () => {
      expect(() => dialect.validateColumns({ ...model, deleteColumn: "deleted" }, columns)).not.toThrow();
      expect(() => dialect.validateColumns(model, [...columns, columns[0]])).toThrow(/duplicate column/);
      expect(() =>
        dialect.validateColumns(model, [{ name: "id", type: types.structured }, ...columns.slice(1)])
      ).toThrow(/Primary-key/);
      expect(() => dialect.validateColumns({ ...model, deleteColumn: "missing" }, columns)).toThrow(/project/);
    });
    it("binds checkpoint values and counts duplicate keys before the incremental filter", () => {
      const result = dialect.compileModel(model, columns, {
        value: "9007199254740993",
        primaryKeyValues: ["x' OR 1=1 --"],
      });
      expect(result.query).toContain("PARTITION BY");
      expect(result.query).toContain("checked_model WHERE");
      expect(result.query).not.toContain("9007199254740993");
      expect(result.query).not.toContain("x' OR");
      expect([...result.values, ...Object.values(result.queryParams)]).toContain("9007199254740993");
    });
    it("supports timestamp lookback without binding primary keys", () => {
      const result = dialect.compileModel(
        { ...model, cursor: { column: "updated", type: "timestamp", lookbackSeconds: 60 } },
        [columns[0], { name: "updated", type: types.timestamp }],
        { value: "2026-01-01 00:00:00.123456", primaryKeyValues: ["key"] }
      );
      expect([...result.values, ...Object.values(result.queryParams)]).toEqual(["2026-01-01 00:00:00.123456"]);
    });
  });
}
