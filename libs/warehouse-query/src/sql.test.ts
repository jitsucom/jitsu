import { describe, expect, it } from "vitest";
import { ModelDefinition, ReverseSyncOptions, validateReverseSyncModel } from "./schema";
import { decodeDelete } from "./sql";
import { getWarehouseSqlDialect } from "./index";
import { postgresSql } from "./postgres";
import { clickhouseSql } from "./clickhouse";

const model = ModelDefinition.parse({
  warehouseId: "wh",
  query: "SELECT id, changed FROM audience",
  primaryKey: ["id"],
  cursor: { column: "changed", type: "number" },
});
const columns = [
  { name: "id", type: "20" },
  { name: "changed", type: "20" },
];

describe("read-only SQL", () => {
  it.each([
    ["SELECT id AS ID FROM USERS; -- tail;", "SELECT id AS ID FROM USERS -- tail;"],
    ["SELECT '; -- not a comment' AS value; /* tail ; */", "SELECT '; -- not a comment' AS value /* tail ; */"],
    ["SELECT ';'';' AS value;", "SELECT ';'';' AS value"],
    ['SELECT 1 AS "semi;colon";', 'SELECT 1 AS "semi;colon"'],
    ["SELECT $$hello; world$$ AS value;", "SELECT $$hello; world$$ AS value"],
    ["SELECT $é$semi;colon$é$ AS value;", "SELECT $é$semi;colon$é$ AS value"],
  ])("preserves original SQL spelling: %s", (input, expected) => {
    expect(postgresSql.validateQuery(input)).toBe(expected);
  });
  it.each(["postgres", "clickhouse"] as const)("accepts SELECTs and SELECT CTEs for %s", dialect => {
    expect(
      getWarehouseSqlDialect(dialect).validateQuery("WITH a AS (SELECT id FROM audience) SELECT id FROM a; -- tail")
    ).toContain("SELECT");
    expect(
      getWarehouseSqlDialect(dialect).validateQuery("SELECT 'delete from t; -- not a comment' AS value")
    ).toContain("delete from t");
  });
  it.each([
    "DELETE FROM audience",
    "SELECT 1; SELECT 2",
    "SELECT * INTO copied FROM audience",
    "SELECT * FROM audience FOR UPDATE",
    "WITH a AS (DELETE FROM audience RETURNING *) SELECT * FROM a",
    "SELECT 1; DROP TABLE audience",
    "SELECT 1\0",
    "",
  ])("rejects unsafe SQL: %s", sql => expect(() => postgresSql.validateQuery(sql)).toThrow());
});

describe("model contracts", () => {
  it("rejects missing/duplicate keys and invalid lookback", () => {
    expect(() => ModelDefinition.parse({ ...model, primaryKey: [] })).toThrow();
    expect(() => ModelDefinition.parse({ ...model, primaryKey: ["id", "id"] })).toThrow();
    expect(() => ModelDefinition.parse({ ...model, cursor: { ...model.cursor, lookbackSeconds: 1 } })).toThrow();
  });
  it.each(["number", "string"])("rejects zero lookback for a %s cursor", type => {
    expect(() => ModelDefinition.parse({ ...model, cursor: { column: "changed", type, lookbackSeconds: 0 } })).toThrow(
      /Lookback requires a timestamp cursor/
    );
  });
  it("requires unique projected columns with a compatible cursor type", () => {
    expect(() => postgresSql.validateColumns(model, columns)).not.toThrow();
    expect(() => postgresSql.validateColumns(model, [columns[0]])).toThrow(/project/);
    expect(() => postgresSql.validateColumns(model, [...columns, columns[0]])).toThrow(/duplicate/);
    expect(() => postgresSql.validateColumns(model, [columns[0], { name: "changed", type: "25" }])).toThrow(
      /does not match/
    );
  });
  it("permanent errors always fail; mirror cannot use incremental models", () => {
    const options = ReverseSyncOptions.parse({ stream: "audience", mode: "mirror", mapping: {} });
    expect(options.errorPolicy).toBe("fail");
    expect(() => ReverseSyncOptions.parse({ ...options, errorPolicy: "skip" })).toThrow();
    expect(() => validateReverseSyncModel(model, options)).toThrow(/Mirror/);
  });
  it.each([true, 1, "1"])("recognizes tombstone %s", value => expect(decodeDelete(value)).toBe(true));
  it.each([false, 0, "0", null])("recognizes live row %s", value => expect(decodeDelete(value)).toBe(false));
  it.each([undefined, "true", "yes", 2])("rejects ambiguous tombstone %s", value =>
    expect(() => decodeDelete(value)).toThrow()
  );
});

describe("checkpoint queries", () => {
  it("binds lossless composite values and applies lexicographic ordering", () => {
    const compiled = postgresSql.compileModel(model, columns, {
      value: "9007199254740993",
      primaryKeyValues: ["1'; DELETE FROM audience; --"],
    });
    expect(compiled.values).toEqual(["9007199254740993", "1'; DELETE FROM audience; --"]);
    expect(compiled.query).toContain('("changed" > $1) OR ("changed" = $1 AND "id" > $2)');
    expect(compiled.query).not.toContain("DELETE");
    expect(compiled.query).toContain('PARTITION BY "id"');
  });
  it.each([0, 60])("lookback %s binds only the timestamp, without unused key parameters", lookbackSeconds => {
    const input = ModelDefinition.parse({
      ...model,
      cursor: { column: "changed", type: "timestamp", lookbackSeconds },
    });
    const result = postgresSql.compileModel(input, [columns[0], { name: "changed", type: "1184" }], {
      value: "2026-01-01 00:00:00.123456+00",
      primaryKeyValues: ["7"],
    });
    expect(result.values).toHaveLength(1);
    expect(result.query).toContain(`INTERVAL '${lookbackSeconds} seconds'`);
    expect(result.query).toContain('"changed" >=');
    expect(result.query).not.toContain('"id" >');
  });
  it("zero lookback does not validate or bind an unbound ClickHouse enum key", () => {
    const input = ModelDefinition.parse({
      ...model,
      cursor: { column: "changed", type: "timestamp", lookbackSeconds: 0 },
    });
    const result = clickhouseSql.compileModel(
      input,
      [
        { name: "id", type: "Enum8('a' = 1)" },
        { name: "changed", type: "DateTime64(6)" },
      ],
      { value: "2026-01-01 00:00:00.123456", primaryKeyValues: ["a"] }
    );
    expect(result.queryParams).toEqual({ p0: "2026-01-01 00:00:00.123456" });
    expect(result.query).toContain("`changed` >= subtractSeconds({p0: DateTime64(6)}, 0)");
  });
  it("ClickHouse parameters use trusted scalar metadata types", () => {
    const result = clickhouseSql.compileModel(
      model,
      [
        { name: "id", type: "UInt64" },
        { name: "changed", type: "Int64" },
      ],
      { value: "10", primaryKeyValues: ["3"] }
    );
    expect(result.queryParams).toEqual({ p0: "10", p1: "3" });
    expect(result.query).toContain("{p0: Int64}");
  });
});
