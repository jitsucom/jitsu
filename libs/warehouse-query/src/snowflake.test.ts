import { generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createSnowflakeReader, snowflakeSql } from "./snowflake";
import { readerDialectContract } from "./reader-contract";
import { supportsWarehouseReader, ModelDefinition } from "./schema";
import type { SourceRecord } from "./types";

const sdk = vi.hoisted(() => ({ createConnection: vi.fn(), configure: vi.fn() }));
vi.mock("snowflake-sdk", () => ({ default: sdk }));
afterEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
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
function fixture(
  results: {
    fields: ReturnType<typeof field>[];
    rows: unknown[][];
    error?: Error;
    delayMs?: number;
    stream?: Readable;
  }[]
) {
  const cancel = vi.fn(callback => callback?.());
  const connection = {
    connect: vi.fn(callback => callback()),
    destroy: vi.fn(callback => callback()),
    execute: vi.fn(options => {
      const result = results.shift()!;
      const statement = {
        getColumns: () => result.fields,
        streamRows: () => result.stream ?? Readable.from(result.rows),
        cancel,
      };
      const complete = () => options.complete(result.error, statement);
      if (result.delayMs !== undefined) setTimeout(complete, result.delayMs);
      else queueMicrotask(complete);
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

it.each([
  ["DATE", "YYYY-MM-DD", "2026-01-01"],
  ["TIME", "HH24:MI:SS.FF9", "12:34:56.123456789"],
  ["TIMESTAMP_NTZ", "YYYY-MM-DD HH24:MI:SS.FF9", "2026-01-01 12:34:56.123456789"],
  ["TIMESTAMP_LTZ", "YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM", "2026-01-01 12:34:56.123456789 +00:00"],
  ["TIMESTAMP_TZ", "YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM", "2026-01-01 12:34:56.123456789 -07:00"],
])("binds %s checkpoint keys and cursors with their explicit output format", async (type, format, value) => {
  const f = fixture([
    { fields: [field("id", type.toLowerCase()), field("updated", "fixed")], rows: [] },
    { fields: [field("id", type.toLowerCase()), field("updated", "fixed")], rows: [] },
  ]);
  const reader = createSnowflakeReader(config);
  const model = testModel({ cursor: { column: "updated", type: "number" } });
  try {
    for await (const _ of reader.stream(model, { value: "1", primaryKeyValues: [value] })) {
      /* consume */
    }
    const options = f.connection.execute.mock.calls[1][0];
    expect(options.sqlText).toContain(`TO_${type}(:2, '${format}')`);
    expect(options.sqlText).not.toContain(value);
    expect(options.binds).toEqual(["1", value]);
    expect(options.parameters[`${type}_OUTPUT_FORMAT`]).toBe(format);
    // Do not change the user's SQL by overriding its inherited input formats.
    expect(options.parameters).not.toHaveProperty(`${type}_INPUT_FORMAT`);
    if (type !== "TIME") {
      for (const lookbackSeconds of [undefined, 60]) {
        const compiled = snowflakeSql.compileModel(
          { ...model, cursor: { column: "updated", type: "timestamp", lookbackSeconds } },
          [
            { name: "id", type: "TEXT" },
            { name: "updated", type },
          ],
          { value, primaryKeyValues: ["a"] }
        );
        expect(compiled.query).toContain(`TO_${type}(:1, '${format}')`);
        expect(compiled.values[0]).toBe(value);
        if (lookbackSeconds !== undefined)
          expect(compiled.query).toContain(`DATEADD(second, -60, TO_${type}(:1, '${format}'))`);
      }
    }
  } finally {
    await reader.close();
  }
});
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

it.each(["__jitsu_retl_key_count", "__JITSU_RETL_KEY_COUNT"])(
  "decodes internal count %s without changing user column names or checkpoints",
  async countName => {
    const fields = [field("ID", "fixed"), field("PAYLOAD", "object")];
    const f = fixture([
      { fields, rows: [] },
      {
        fields: [field("ID", "fixed"), field("PAYLOAD"), field(countName, "fixed")],
        rows: [["1", '{"value":9007199254740993}', "1"]],
      },
    ]);
    const records = await collect(testModel({ primaryKey: ["ID"], cursor: { column: "ID", type: "number" } }));
    expect(records).toEqual([
      {
        row: { ID: "1", PAYLOAD: '{"value":9007199254740993}' },
        deleted: false,
        checkpoint: { value: "1", primaryKeyValues: ["1"] },
      },
    ]);
    const options = f.connection.execute.mock.calls[1][0];
    expect(options.sqlText).toContain('TO_JSON(TO_VARIANT("PAYLOAD")) AS "PAYLOAD"');
    expect(options.parameters).not.toHaveProperty("QUOTED_IDENTIFIERS_IGNORE_CASE");
  }
);

it("still rejects duplicate keys when Snowflake uppercases the internal count", async () => {
  fixture([
    { fields: [field("ID", "fixed")], rows: [] },
    { fields: [field("ID", "fixed"), field("__JITSU_RETL_KEY_COUNT", "fixed")], rows: [["1", "2"]] },
  ]);
  await expect(collect(testModel({ primaryKey: ["ID"] }))).rejects.toThrow("duplicate primary keys");
});

it.each(["__jitsu_retl_key_count", "__JITSU_RETL_KEY_COUNT", "__Jitsu_Retl_Key_Count"])(
  "rejects source columns colliding with reserved alias %s before extraction",
  async name => {
    const f = fixture([{ fields: [field("ID", "fixed"), field(name, "fixed")], rows: [] }]);
    await expect(collect(testModel({ primaryKey: ["ID"] }))).rejects.toThrow("reserved");
    expect(f.connection.execute).toHaveBeenCalledTimes(1);
    expect(f.connection.destroy).toHaveBeenCalled();
  }
);

it("disables actual SDK value-bearing warnings before preview and extraction connections", async () => {
  const realSdk = (await vi.importActual<{ default: typeof import("snowflake-sdk") }>("snowflake-sdk")).default;
  const winston = require(require.resolve("winston", { paths: [sdkDirectory] }));
  const write = vi.fn();
  // Intercept the transport factory, not the SDK logger/decoder: no test values
  // are written to stdout or snowflake.log even when demonstrating the old leak.
  const transports = vi.spyOn(winston, "createLogger").mockImplementation(
    class {
      ERROR = write;
      WARN = write;
      INFO = write;
      DEBUG = write;
      TRACE = write;
      close = () => {};
    }
  );
  const consoleTransport = vi.spyOn(winston.transports, "Console").mockImplementation(class {});
  const fileTransport = vi.spyOn(winston.transports, "File").mockImplementation(class {});
  const raw = "9007199254740993";
  const decode = () => {
    const column = new RealColumn({
      columnMetadata: numberColumn("id"),
      index: 0,
      statementParameters: {},
      resultVersion: 1,
      onPrecisionLoss() {},
    });
    return column._getRowValueAsString({ values: [raw], _arrayProcessedColumns: [] });
  };
  const reader = createSnowflakeReader(config);
  try {
    realSdk.configure({ logLevel: "WARN" });
    expect(decode()).toBe(raw);
    expect(write).toHaveBeenCalledWith(expect.stringContaining(raw));
    write.mockClear();
    transports.mockClear();
    consoleTransport.mockClear();
    fileTransport.mockClear();
    sdk.configure.mockImplementation(options => realSdk.configure(options));
    decodedFixture([numberColumn("id")], [[raw]]);
    expect((await reader.preview("SELECT * FROM source")).rows).toEqual([{ id: raw }]);
    expect((await collect())[0].row.id).toBe(raw);
    expect(sdk.configure).toHaveBeenCalledTimes(2);
    expect(sdk.configure).toHaveBeenCalledWith({ logLevel: "OFF" });
    expect(sdk.createConnection.mock.calls[0][0].clientConfigFile).toBe("");
    for (let i = 0; i < 2; i++)
      expect(sdk.configure.mock.invocationCallOrder[i]).toBeLessThan(sdk.createConnection.mock.invocationCallOrder[i]);
    expect(write).not.toHaveBeenCalled();
    expect(transports).not.toHaveBeenCalled();
    expect(consoleTransport).not.toHaveBeenCalled();
    expect(fileTransport).not.toHaveBeenCalled();
  } finally {
    await reader.close();
    realSdk.configure({ logLevel: "OFF" });
    transports.mockRestore();
    consoleTransport.mockRestore();
    fileTransport.mockRestore();
  }
});

it("prevents SDK Easy Logging from discovering host configuration", async () => {
  const { ConfigurationUtil } = require(join(sdkDirectory, "lib/configuration/client_configuration.js"));
  // Pin the SDK's explicit-empty-path behavior: no environment or filesystem
  // discovery may run, even when the host has enabled Easy Logging elsewhere.
  const unexpectedLookup = () => {
    throw new Error("SDK attempted host logging configuration lookup");
  };
  const configuration = new ConfigurationUtil(new Proxy({}, { get: unexpectedLookup }), {
    get env() {
      return unexpectedLookup();
    },
  });
  const f = fixture([{ fields: [field("id")], rows: [] }]);
  const reader = createSnowflakeReader(config);
  try {
    await reader.columns("SELECT id FROM source");
    const options = sdk.createConnection.mock.calls[0][0];
    await expect(configuration.getClientConfig(options.clientConfigFile)).resolves.toBeNull();
    expect(f.connection.destroy).toHaveBeenCalled();
  } finally {
    await reader.close();
  }
});

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

function executionFixture(delayMs: number, stream?: Readable) {
  return fixture([
    { fields: [field("id")], rows: [] },
    {
      fields: [field("id"), field("__jitsu_retl_key_count", "fixed")],
      rows: [["a", "1"]],
      delayMs,
      stream,
    },
  ]);
}

it("allows extraction execution beyond 30 seconds before streaming rows", async () => {
  vi.useFakeTimers();
  const f = executionFixture(35_000);
  const pending = collect(testModel());
  const resolved = expect(pending).resolves.toMatchObject([{ row: { id: "a" } }]);
  await vi.advanceTimersByTimeAsync(30_001);
  expect(f.connection.execute).toHaveBeenCalledTimes(2);
  expect(f.cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4_999);
  await resolved;
  expect(f.connection.destroy).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps the overall extraction deadline across consecutive executions", async () => {
  vi.useFakeTimers();
  const f = fixture([
    { fields: [field("id")], rows: [], delayMs: 35_000 },
    { fields: [field("id")], rows: [], delayMs: 2 * 60 * 60 * 1000 },
  ]);
  const rejected = expect(collect(testModel())).rejects.toThrow("Warehouse extraction deadline exceeded");
  await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
  await rejected;
  expect(f.connection.execute).toHaveBeenCalledTimes(2);
  expect(f.cancel).toHaveBeenCalled();
  expect(f.connection.destroy).toHaveBeenCalled();
  // A late SDK callback cannot start reading after the extraction was aborted.
  await vi.advanceTimersByTimeAsync(35_000);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps preview execution bounded to 30 seconds", async () => {
  vi.useFakeTimers();
  const f = executionFixture(35_000);
  const reader = createSnowflakeReader(config);
  const rejected = expect(reader.preview("SELECT id FROM source")).rejects.toThrow(
    "Warehouse extraction deadline exceeded"
  );
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(f.cancel).toHaveBeenCalled();
  expect(f.connection.destroy).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5_000);
  await reader.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels a long-running extraction on parent abort and ignores late completion", async () => {
  vi.useFakeTimers();
  const stream = new Readable({ objectMode: true, read() {} });
  const f = executionFixture(35_000, stream);
  const parent = new AbortController();
  const reader = createSnowflakeReader(config);
  const iterator = reader.stream(testModel(), undefined, parent.signal)[Symbol.asyncIterator]();
  const rejected = expect(iterator.next()).rejects.toThrow("cancelled by user");
  await vi.advanceTimersByTimeAsync(31_000);
  parent.abort(new Error("cancelled by user"));
  await rejected;
  expect(f.cancel).toHaveBeenCalled();
  expect(f.connection.destroy).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4_000);
  expect(stream.readableFlowing).toBeNull();
  stream.destroy();
  await reader.close();
  expect(vi.getTimerCount()).toBe(0);
});

it("still times out stalled row reads after a long execution", async () => {
  vi.useFakeTimers();
  const stream = new Readable({ objectMode: true, read() {} });
  const f = executionFixture(35_000, stream);
  const rejected = expect(collect(testModel())).rejects.toThrow("Warehouse read timed out");
  await vi.advanceTimersByTimeAsync(35_000);
  expect(f.cancel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(stream.destroyed).toBe(true);
  expect(f.cancel).toHaveBeenCalled();
  expect(f.connection.destroy).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("still bounds connection establishment to 30 seconds", async () => {
  vi.useFakeTimers();
  const f = fixture([]);
  f.connection.connect.mockImplementation(() => {});
  const rejected = expect(collect(testModel())).rejects.toThrow("Warehouse read timed out");
  await vi.advanceTimersByTimeAsync(30_000);
  await rejected;
  expect(f.connection.execute).not.toHaveBeenCalled();
  expect(f.connection.destroy).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
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
