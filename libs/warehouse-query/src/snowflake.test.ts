import { generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createSnowflakeReader, snowflakeSql } from "./snowflake";
import { readerDialectContract } from "./reader-contract";
import { supportsWarehouseReader, ModelDefinition } from "./schema";
import type { SourceRecord } from "./types";

const sdk = vi.hoisted(() => ({ createConnection: vi.fn() }));
vi.mock("snowflake-sdk", () => ({ default: sdk }));
afterEach(() => vi.resetAllMocks());
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const config = {
  destinationType: "snowflake",
  authenticationMethod: "key-pair",
  account: "org-account",
  username: "reader",
  warehouse: "COMPUTE",
  database: "TEST",
  privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
};
const field = (name: string, type = "text", scale = 0) => ({
  getName: () => name,
  getType: () => type,
  getScale: () => scale,
  getPrecision: () => 38,
});
function fixture(results: { fields: ReturnType<typeof field>[]; rows: unknown[][]; error?: Error }[]) {
  const cancel = vi.fn(callback => callback?.());
  const connection = {
    connect: vi.fn(callback => callback()),
    destroy: vi.fn(callback => callback()),
    execute: vi.fn(options => {
      const result = results.shift()!;
      const statement = { getColumns: () => result.fields, streamRows: () => Readable.from(result.rows), cancel };
      queueMicrotask(() => options.complete(result.error, statement));
      return statement;
    }),
  };
  sdk.createConnection.mockReturnValue(connection);
  return { connection, cancel };
}
readerDialectContract("Snowflake", snowflakeSql, {
  key: "TEXT",
  number: "NUMBER(38,0)",
  timestamp: "TIMESTAMP_NTZ",
  structured: "OBJECT",
});
it("advertises key-pair only and rejects unsupported auth without connecting", () => {
  expect(supportsWarehouseReader(config)).toBe(true);
  expect(supportsWarehouseReader({ ...config, authenticationMethod: "password" })).toBe(false);
  expect(() => createSnowflakeReader({ ...config, authenticationMethod: "password" })).toThrow();
  expect(sdk.createConnection).not.toHaveBeenCalled();
});
it("uses encrypted keys, ignores unsafe connection parameters, and streams exact values", async () => {
  const fields = [field("id", "fixed"), field("updated", "timestamp_ntz"), field("deleted", "boolean")];
  const f = fixture([
    { fields, rows: [] },
    {
      fields: [...fields, field("__jitsu_retl_key_count", "fixed")],
      rows: [["9007199254740993", "2026-01-01 00:00:00.123456789", true, "1"]],
    },
  ]);
  const reader = createSnowflakeReader({
    ...config,
    privateKey: privateKey
      .export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase: "test-passphrase" })
      .toString(),
    privateKeyPassphrase: "test-passphrase",
    parameters: { role: "READER", host: "evil.invalid", insecureConnect: "true" },
  });
  const model = ModelDefinition.parse({
    warehouseId: "wh",
    query: "SELECT id, updated, deleted FROM source",
    primaryKey: ["id"],
    cursor: { column: "updated", type: "timestamp" },
    deleteColumn: "deleted",
  });
  const records: SourceRecord[] = [];
  for await (const row of reader.stream(model)) records.push(row);
  expect(records).toEqual([
    {
      row: { id: "9007199254740993", updated: "2026-01-01 00:00:00.123456789", deleted: true },
      deleted: true,
      checkpoint: { value: "2026-01-01 00:00:00.123456789", primaryKeyValues: ["9007199254740993"] },
    },
  ]);
  expect(sdk.createConnection.mock.calls[0][0]).toMatchObject({ role: "READER", authenticator: "SNOWFLAKE_JWT" });
  expect(sdk.createConnection.mock.calls[0][0]).not.toHaveProperty("host");
  expect(f.connection.execute.mock.calls[1][0]).toMatchObject({
    streamResult: true,
    rowMode: "array",
    fetchAsString: ["Number", "Date", "JSON"],
    parameters: { TIME_OUTPUT_FORMAT: "HH24:MI:SS.FF9" },
  });
  expect(f.connection.destroy).toHaveBeenCalled();
  await reader.close();
});
it("bounds previews and preserves metadata for an empty result", async () => {
  fixture([
    { fields: [field("id")], rows: [] },
    { fields: [field("id")], rows: Array.from({ length: 101 }, (_, i) => [String(i)]) },
    { fields: [field("id")], rows: [] },
    { fields: [field("id")], rows: [] },
  ]);
  const reader = createSnowflakeReader(config);
  expect(await reader.preview("SELECT id FROM source")).toMatchObject({ truncated: true, rows: expect.any(Array) });
  expect(await reader.preview("SELECT id FROM source")).toEqual({
    columns: [{ name: "id", type: "TEXT" }],
    rows: [],
    truncated: false,
  });
  await reader.close();
});
it.each(["oversize", "query error", "duplicate key"])("cleans up on %s", async kind => {
  const f = fixture(
    kind === "duplicate key"
      ? [
          { fields: [field("id")], rows: [] },
          { fields: [field("id"), field("__jitsu_retl_key_count", "fixed")], rows: [["a", "2"]] },
        ]
      : [
          { fields: [field("id")], rows: [] },
          {
            fields: [field("id")],
            rows: [["x".repeat(2_000_001)]],
            error: kind === "query error" ? new Error("invalid identifier") : undefined,
          },
        ]
  );
  const reader = createSnowflakeReader(config);
  if (kind === "duplicate key")
    await expect(async () => {
      for await (const _ of reader.stream(
        ModelDefinition.parse({ warehouseId: "wh", query: "SELECT id FROM source", primaryKey: ["id"] })
      )) {
        /* consume */
      }
    }).rejects.toThrow(/duplicate/);
  else
    await expect(reader.preview("SELECT id FROM source")).rejects.toThrow(
      kind === "oversize" ? /2 MB/ : /invalid identifier/
    );
  expect(f.connection.destroy).toHaveBeenCalled();
  await reader.close();
});

const sdkDirectory = dirname(require.resolve("snowflake-sdk"));
const RealColumn = require(join(sdkDirectory, "lib/connection/result/column.js"));
const DataTypes = require(join(sdkDirectory, "lib/connection/result/data_types.js"));
afterEach(() => DataTypes.setIsRepresentNullAsStringNull(true));

// Mock the server's wire response, not the SDK's decoded values. A TO_JSON
// projection returns VARCHAR on the wire; metadata probes keep original types.
function decodedFixture(metadata: any[], rawRows: unknown[][]) {
  const f = fixture([]);
  sdk.createConnection.mockImplementation(options => {
    DataTypes.setIsRepresentNullAsStringNull(options.representNullAsStringNull ?? true);
    return f.connection;
  });
  f.connection.execute.mockImplementation(options => {
    const probe = options.sqlText.endsWith("LIMIT 0");
    const counted = options.sqlText.includes("count(*) OVER");
    const wireMetadata = metadata.map(column =>
      !probe && options.sqlText.includes(`TO_JSON(TO_VARIANT("${column.name.replaceAll('"', '""')}"))`)
        ? { ...column, type: "text", fields: undefined }
        : column
    );
    if (counted) wireMetadata.push({ name: "__jitsu_retl_key_count", type: "fixed", precision: 38, scale: 0 });
    const columns = wireMetadata.map(
      (columnMetadata, index) =>
        new RealColumn({
          columnMetadata,
          index,
          statementParameters: options.parameters,
          resultVersion: 1,
          onPrecisionLoss() {},
          onNonJsonCompliantVariant() {},
        })
    );
    const statement = {
      getColumns: () => columns,
      streamRows: () =>
        Readable.from(
          probe
            ? []
            : rawRows.map(raw => {
                const row = { values: counted ? [...raw, "1"] : [...raw], _arrayProcessedColumns: [] };
                return columns.map(column =>
                  options.fetchAsString.map(s => s.toUpperCase()).includes(DataTypes.toNativeType(column.getType()))
                    ? column._getRowValueAsString(row)
                    : column._getRowValue(row)
                );
              })
        ),
      cancel: f.cancel,
    };
    queueMicrotask(() => options.complete(null, statement));
    return statement;
  });
  return f;
}
const numberColumn = (name: string, scale = 0) => ({ name, type: "fixed", precision: 38, scale, nullable: true });
const testModel = (extra = {}) =>
  ModelDefinition.parse({ warehouseId: "wh", query: "SELECT * FROM source", primaryKey: ["id"], ...extra });
async function collect(model = testModel()) {
  const reader = createSnowflakeReader(config);
  try {
    const result: SourceRecord[] = [];
    for await (const record of reader.stream(model)) result.push(record);
    return result;
  } finally {
    await reader.close();
  }
}

it("preserves SQL nulls through the SDK in preview and extraction, including TIME", async () => {
  decodedFixture(
    [
      numberColumn("id"),
      ...["fixed", "date", "time", "timestamp_ntz", "timestamp_ltz", "timestamp_tz"].map(type => ({
        name: type,
        type,
        precision: 38,
        scale: 9,
        nullable: true,
      })),
    ],
    [["1", null, null, null, null, null, null]]
  );
  const reader = createSnowflakeReader(config);
  try {
    expect((await reader.preview("SELECT * FROM source")).rows[0]).toEqual({
      id: "1",
      fixed: null,
      date: null,
      time: null,
      timestamp_ntz: null,
      timestamp_ltz: null,
      timestamp_tz: null,
    });
    expect(sdk.createConnection.mock.calls[0][0].representNullAsStringNull).toBe(false);
    expect((await collect())[0].row.fixed).toBeNull();
  } finally {
    await reader.close();
  }
});
it.each(["key", "cursor"])("rejects a SQL-null numeric %s after actual SDK decoding", async kind => {
  decodedFixture([numberColumn("id"), numberColumn("updated")], [[kind === "key" ? null : "1", null]]);
  await expect(
    collect(testModel(kind === "cursor" ? { cursor: { column: "updated", type: "number" } } : {}))
  ).rejects.toThrow(/non-null/);
});
it.each(["object", "array", "map"])(
  "serializes %s payloads before SDK parsing while preserving original metadata",
  async type => {
    const payload = type === "array" ? "[9007199254740993]" : '{"id":9007199254740993}';
    const f = decodedFixture(
      [numberColumn("id"), { name: 'pay"load', type, fields: [numberColumn("id")] }],
      [
        ["1", payload],
        ["2", null],
      ]
    );
    const reader = createSnowflakeReader(config);
    try {
      const preview = await reader.preview("SELECT * FROM source");
      expect(preview.columns[1].type).toBe(type.toUpperCase());
      expect(preview.rows.map(r => r['pay"load'])).toEqual([payload, null]);
      expect((await collect()).map(r => r.row['pay"load'])).toEqual([payload, null]);
      const query = f.connection.execute.mock.calls.at(-1)![0].sqlText;
      expect(query).toContain('TO_JSON(TO_VARIANT("pay""load")) AS "pay""load"');
      expect(query).toMatch(/ORDER BY "id" ASC$/);
    } finally {
      await reader.close();
    }
  }
);
it.each(["0.00", "1.00", "-0.000", "+1.0", "1e0", "10e-1", "0e1000"])(
  "decodes exact numeric tombstone %s without rewriting payloads or checkpoints",
  async value => {
    decodedFixture([numberColumn("id"), numberColumn("deleted", 2)], [["1", value]]);
    const [record] = await collect(
      testModel({ deleteColumn: "deleted", cursor: { column: "deleted", type: "number" } })
    );
    expect(record.deleted).toBe(!/^[-+]?0/.test(value));
    expect(record.row.deleted).toBe(value);
    expect(record.checkpoint?.value).toBe(value);
  }
);
it.each(["1.00000000000000000001", "0.00000000000000000001", "2.00", "-1.00", "1e-1000"])(
  "rejects numeric tombstone %s instead of rounding it",
  async value => {
    decodedFixture([numberColumn("id"), numberColumn("deleted", 20)], [["1", value]]);
    await expect(collect(testModel({ deleteColumn: "deleted" }))).rejects.toThrow(/0\/1/);
  }
);
it("keeps text tombstones strict", async () => {
  decodedFixture([numberColumn("id"), { name: "deleted", type: "text" }], [["1", "1.00"]]);
  await expect(collect(testModel({ deleteColumn: "deleted" }))).rejects.toThrow(/0\/1/);
});
it("accepts REAL zero/one and null numeric tombstones", async () => {
  decodedFixture(
    [numberColumn("id"), { name: "deleted", type: "real" }],
    [
      ["1", "0e0"],
      ["2", "1.0e0"],
      ["3", null],
    ]
  );
  expect((await collect(testModel({ deleteColumn: "deleted" }))).map(row => row.deleted)).toEqual([false, true, false]);
});
it("cancels an in-flight statement when closed", async () => {
  const f = fixture([]);
  f.connection.execute.mockImplementation(() => ({ cancel: f.cancel } as any));
  const reader = createSnowflakeReader(config);
  const pending = reader.preview("SELECT id FROM source");
  await vi.waitFor(() => expect(f.connection.execute).toHaveBeenCalled());
  const rejected = expect(pending).rejects.toThrow();
  await reader.close();
  await rejected;
  expect(f.cancel).toHaveBeenCalled();
  expect(f.connection.destroy).toHaveBeenCalled();
  await expect(reader.columns("SELECT 1")).rejects.toThrow(/closed/);
});

it("preserves fractional TIME keys through the real SDK decoder", async () => {
  // Pin this regression to the installed driver's decoder, not fabricated decoded rows.
  const Column = require(join(dirname(require.resolve("snowflake-sdk")), "lib/connection/result/column.js"));
  const f = fixture([]);
  f.connection.execute.mockImplementation(options => {
    const values = ["45296.123456789", "45296.987654321"].map(value => {
      const column = new Column({
        columnMetadata: { name: "id", type: "time", scale: 9, nullable: false },
        index: 0,
        statementParameters: options.parameters,
        resultVersion: 1,
      });
      return [column._getRowValue({ values: [value], _arrayProcessedColumns: [] })];
    });
    const statement = {
      getColumns: () => [field("id", "time")],
      streamRows: () => Readable.from(values),
      cancel: f.cancel,
    };
    queueMicrotask(() => options.complete(null, statement));
    return statement;
  });
  const reader = createSnowflakeReader(config);
  try {
    expect((await reader.preview("SELECT id FROM source")).rows).toEqual([
      { id: "12:34:56.123456789" },
      { id: "12:34:56.987654321" },
    ]);
  } finally {
    await reader.close();
  }
});
