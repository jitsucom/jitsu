import { describe, expect, it } from "vitest";
import { postgresSql } from "./postgres";
import { clickhouseSql } from "./clickhouse";
import { ModelDefinition } from "./schema";

describe.each([
  {
    name: "Postgres",
    sql: postgresSql,
    keyType: "20",
    accepted: ["16", "18", "19", "20", "21", "23", "25", "26", "700", "701", "1042", "1043", "1700"],
    rejected: ["17", "114", "3802", "1007", "1082", "1114", "1184", "2950", "999999"],
  },
  {
    name: "ClickHouse",
    sql: clickhouseSql,
    keyType: "UInt64",
    accepted: [
      "Bool",
      "UInt8",
      "Int64",
      "Float64",
      "Decimal(18, 0)",
      "String",
      "FixedString(1)",
      "Nullable(String)",
      "LowCardinality(Nullable(String))",
      "Enum8('0' = 0, '1' = 1)",
      "Nullable(Nothing)",
    ],
    rejected: [
      "Array(String)",
      "Map(String, UInt64)",
      "Tuple(UInt8)",
      "DateTime64(6)",
      "Date",
      "UUID",
      "FixedString(16)",
      "JSON",
      "Unknown",
    ],
  },
])("$name delete-column compatibility", ({ sql, keyType, accepted, rejected }) => {
  const model = ModelDefinition.parse({
    warehouseId: "wh",
    query: "SELECT id, removed FROM t",
    primaryKey: ["id"],
    deleteColumn: "removed",
  });
  it.each(accepted)("accepts %s while leaving value checks to runtime", type => {
    expect(sql.supportsDeleteType(type)).toBe(true);
    expect(() =>
      sql.validateColumns(model, [
        { name: "id", type: keyType },
        { name: "removed", type },
      ])
    ).not.toThrow();
  });
  it.each(rejected)("rejects %s before a save or stream", type => {
    const columns = [
      { name: "id", type: keyType },
      { name: "removed", type },
    ];
    expect(sql.supportsDeleteType(type)).toBe(false);
    expect(() => sql.validateColumns(model, columns)).toThrow(/Delete column 'removed'.*use a boolean expression/);
    expect(() => sql.compileModel(model, columns)).toThrow(/Delete column 'removed'/);
    expect(() => sql.validateColumns({ ...model, deleteColumn: undefined }, columns)).not.toThrow();
  });
});
