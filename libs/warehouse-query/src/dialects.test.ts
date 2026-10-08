import { describe, expect, it } from "vitest";
import { createWarehouseReader, getWarehouseSqlDialect } from "./index";
import { postgresSql, losslessTypes } from "./postgres";
import { clickhouseSql } from "./clickhouse";
import { ModelDefinition } from "./schema";

describe("warehouse-owned SQL", () => {
  it("selects pure SQL policy without credentials or a connection", async () => {
    expect(getWarehouseSqlDialect("postgres")).toBe(postgresSql);
    expect(getWarehouseSqlDialect("clickhouse")).toBe(clickhouseSql);
    expect(() => getWarehouseSqlDialect("unknown")).toThrow(/not supported/);
    const pg = createWarehouseReader({ destinationType: "postgres", host: "unused.invalid", database: "unused" });
    const ch = createWarehouseReader({
      destinationType: "clickhouse",
      protocol: "http",
      hosts: ["unused.invalid"],
      password: "",
    });
    try {
      expect(pg.sql).toBe(postgresSql);
      expect(ch.sql).toBe(clickhouseSql);
    } finally {
      await Promise.all([pg.close(), ch.close()]);
    }
  });

  it("uses only the current warehouse's cursor type vocabulary", () => {
    const model = ModelDefinition.parse({
      warehouseId: "wh",
      query: "SELECT id, changed FROM t",
      primaryKey: ["id"],
      cursor: { column: "changed", type: "number" },
    });
    for (const [dialect, ownType, otherType] of [
      [postgresSql, "20", "Int64"],
      [clickhouseSql, "Nullable(Int64)", "20"],
    ] as const) {
      const columns = [
        { name: "id", type: ownType },
        { name: "changed", type: ownType },
      ];
      expect(() => dialect.validateColumns(model, columns)).not.toThrow();
      expect(() => dialect.validateColumns(model, [columns[0], { name: "changed", type: otherType }])).toThrow(
        /does not match/
      );
    }
  });

  it("preserves ClickHouse literals and hash comments", () => {
    const query = "SELECT 'semi;colon' AS value; # tail;";
    expect(clickhouseSql.validateQuery(query)).toBe("SELECT 'semi;colon' AS value # tail;");
  });

  it("binds ClickHouse lookback with its own syntax and no key parameter", () => {
    const model = ModelDefinition.parse({
      warehouseId: "wh",
      query: "SELECT id, changed FROM t",
      primaryKey: ["id"],
      cursor: { column: "changed", type: "timestamp", lookbackSeconds: 60 },
    });
    const result = clickhouseSql.compileModel(
      model,
      [
        { name: "id", type: "UInt64" },
        { name: "changed", type: "DateTime64(6, 'UTC')" },
      ],
      { value: "2026-01-01 00:00:00.123456", primaryKeyValues: ["9007199254740993"] }
    );
    expect(result.queryParams).toEqual({ p0: "2026-01-01 00:00:00.123456" });
    expect(result.values).toEqual([]);
    expect(result.query).toContain("`changed` >= subtractSeconds({p0: DateTime64(6, 'UTC')}, 60)");
  });

  it("rejects unsafe ClickHouse checkpoint metadata before inserting it into SQL", () => {
    const model = ModelDefinition.parse({
      warehouseId: "wh",
      query: "SELECT id, changed FROM t",
      primaryKey: ["id"],
      cursor: { column: "changed", type: "number" },
    });
    expect(() =>
      clickhouseSql.compileModel(
        model,
        [
          { name: "id", type: "String}; DROP TABLE t; --" },
          { name: "changed", type: "Int64" },
        ],
        { value: "1", primaryKeyValues: ["key"] }
      )
    ).toThrow(/Primary-key column 'id' has unsupported warehouse type/);
  });
});

describe("ClickHouse checkpoint compatibility", () => {
  it.each(["DateTime('Etc/GMT+3')", "DateTime64(6, 'Etc/GMT+3')"])("validates and binds numeric timezone %s", type => {
    const input = ModelDefinition.parse({
      warehouseId: "wh",
      query: "SELECT id, changed FROM t",
      primaryKey: ["id"],
      cursor: { column: "changed", type: "timestamp" },
    });
    const columns = [
      { name: "id", type },
      { name: "changed", type },
    ];
    expect(() => clickhouseSql.validateColumns(input, columns)).not.toThrow();
    const result = clickhouseSql.compileModel(input, columns, {
      value: "2026-01-01 00:00:00",
      primaryKeyValues: ["2026-01-01 00:00:00"],
    });
    expect(result.query).toContain("{p0: " + type + "}");
    expect(result.query).toContain("{p1: " + type + "}");
  });
  it.each(["DateTime('Etc/GMT+3'); DROP TABLE t", "DateTime64(6, 'Etc/GMT+3'} )", "DateTime64(6, 'Etc/GMT+3\\')"])(
    "still rejects unsafe timezone metadata %s",
    type => {
      const input = ModelDefinition.parse({
        warehouseId: "wh",
        query: "SELECT id, changed FROM t",
        primaryKey: ["id"],
        cursor: { column: "changed", type: "timestamp" },
      });
      expect(() =>
        clickhouseSql.compileModel(
          input,
          [
            { name: "id", type: "String" },
            { name: "changed", type },
          ],
          { value: "1", primaryKeyValues: ["a"] }
        )
      ).toThrow();
    }
  );
  const model = ModelDefinition.parse({
    warehouseId: "wh",
    query: "SELECT id, changed FROM t",
    primaryKey: ["id"],
    cursor: { column: "changed", type: "number" },
  });
  it.each([
    ["LowCardinality(String)", "String"],
    ["FixedString(16)", "FixedString(16)"],
    ["LowCardinality(FixedString(16))", "FixedString(16)"],
    ["LowCardinality(Nullable(String))", "Nullable(String)"],
    ["Nullable(FixedString(16))", "Nullable(FixedString(16))"],
  ])("validates and binds %s keys and cursors", (type, boundType) => {
    const columns = [
      { name: "id", type },
      { name: "changed", type: "UInt64" },
    ];
    for (const input of [model, { ...model, cursor: { column: "id", type: "string" as const } }]) {
      expect(() => clickhouseSql.validateColumns(input, columns)).not.toThrow();
      expect(() => clickhouseSql.compileModel(input, columns)).not.toThrow();
      const result = clickhouseSql.compileModel(input, columns, { value: "1", primaryKeyValues: ["a\0"] });
      expect(result.query).toContain("{p1: " + boundType + "}");
      expect(result.queryParams.p1).toBe("a\0");
    }
  });
  it.each([
    "Array(String)",
    "Enum8('a' = 1)",
    "LowCardinality(Array(String))",
    "Nullable(String",
    "String)",
    "LowCardinality(String))",
    "FixedString(0)",
    "LowCardinality(String)}; DROP TABLE t; --",
  ])("rejects unsupported key type %s before any checkpoint", type => {
    const columns = [
      { name: "id", type },
      { name: "changed", type: "UInt64" },
    ];
    const error = type.startsWith("Enum")
      ? /Unsupported checkpoint type/
      : /Primary-key column 'id' has unsupported warehouse type/;
    expect(() => clickhouseSql.validateColumns(model, columns)).toThrow(error);
    expect(() => clickhouseSql.compileModel(model, columns)).toThrow(error);
  });
  it("applies the binding restriction to cursor metadata too", () => {
    const input = { ...model, cursor: { column: "changed", type: "timestamp" as const } };
    expect(() =>
      clickhouseSql.validateColumns(input, [
        { name: "id", type: "String" },
        { name: "changed", type: "DateTime64(6); DROP TABLE t" },
      ])
    ).toThrow();
  });
  it("allows scalar Enum keys when full-query or lookback does not bind them", () => {
    const columns = [
      { name: "id", type: "Enum8('a' = 1)" },
      { name: "changed", type: "DateTime64(6)" },
    ];
    expect(() => clickhouseSql.validateColumns({ ...model, cursor: undefined }, columns)).not.toThrow();
    const input = { ...model, cursor: { column: "changed", type: "timestamp" as const, lookbackSeconds: 60 } };
    expect(() =>
      clickhouseSql.compileModel(input, columns, {
        value: "2026-01-01 00:00:00.123456",
        primaryKeyValues: ["a"],
      })
    ).not.toThrow();
  });
});

describe.each([
  {
    warehouse: "Postgres",
    dialect: postgresSql,
    cursorType: "1184",
    supported: [
      "16",
      "18",
      "19",
      "20",
      "21",
      "23",
      "25",
      "26",
      "700",
      "701",
      "1042",
      "1043",
      "1082",
      "1083",
      "1114",
      "1184",
      "1266",
      "1700",
      "2950",
    ],
    unsupported: ["17", "114", "3802", "1007", "1009", "1186", "600", "718", "999999"],
  },
  {
    warehouse: "ClickHouse",
    dialect: clickhouseSql,
    cursorType: "DateTime64(6)",
    supported: [
      "String",
      "UInt64",
      "Decimal(18, 6)",
      "DateTime64(6, 'UTC')",
      "DateTime('Etc/GMT+3')",
      "DateTime64(6, 'Etc/GMT+3')",
      "Nullable(String)",
      "LowCardinality(Nullable(String))",
      "Bool",
      "IPv4",
      "IPv6",
      "Enum8('a' = 1)",
      "Enum16('a' = 1)",
    ],
    unsupported: [
      "Array(String)",
      "Map(String, UInt64)",
      "Tuple(String, UInt64)",
      "JSON",
      "Object('json')",
      "Nullable(Nothing)",
      "LowCardinality(Array(String))",
      "Dynamic",
      "Unknown",
    ],
  },
])("$warehouse primary-key decoding compatibility", ({ dialect, cursorType, supported, unsupported }) => {
  const model = ModelDefinition.parse({
    warehouseId: "wh",
    query: "SELECT id, changed FROM t",
    primaryKey: ["id"],
  });
  it.each(unsupported)("rejects %s in full-query, incremental and lookback models", type => {
    const columns = [
      { name: "id", type },
      { name: "changed", type: cursorType },
    ];
    for (const cursor of [
      undefined,
      { column: "changed", type: "timestamp" as const },
      { column: "changed", type: "timestamp" as const, lookbackSeconds: 60 },
    ]) {
      expect(() => dialect.validateColumns({ ...model, cursor }, columns)).toThrow(
        /Primary-key column 'id'.*cast it to a supported scalar type/
      );
      expect(() => dialect.compileModel({ ...model, cursor }, columns)).toThrow(/Primary-key column 'id'/);
    }
  });
  it.each(supported)("accepts scalar %s for full-query and lookback keys", type => {
    const columns = [
      { name: "id", type },
      { name: "changed", type: cursorType },
    ];
    expect(() => dialect.validateColumns(model, columns)).not.toThrow();
    expect(() =>
      dialect.validateColumns(
        { ...model, cursor: { column: "changed", type: "timestamp", lookbackSeconds: 60 } },
        columns
      )
    ).not.toThrow();
  });
  it("validates every member of a composite key", () => {
    expect(() =>
      dialect.validateColumns({ ...model, primaryKey: ["changed", "id"] }, [
        { name: "id", type: unsupported[0] },
        { name: "changed", type: cursorType },
      ])
    ).toThrow(/Primary-key column 'id'/);
  });
});

describe("PostgreSQL lossless text decoding", () => {
  it.each([
    [20, "9007199254740993"],
    [1700, "12345678901234567890.12345678901234567890"],
    [1082, "2026-01-01"],
    [1114, "2026-01-01 00:00:00.123456"],
    [1184, "2026-01-01 00:00:00.123456+00"],
  ] as const)("preserves exact text for OID %i", (oid, value) => {
    expect(losslessTypes.getTypeParser(oid, "text")(value)).toBe(value);
  });
  it("keeps standard decoding for other scalar types", () => {
    expect(losslessTypes.getTypeParser(23, "text")("42")).toBe(42);
    expect(losslessTypes.getTypeParser(16, "text")("t")).toBe(true);
  });
});
