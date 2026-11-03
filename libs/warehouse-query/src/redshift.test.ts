import { afterEach, expect, it, vi } from "vitest";
import { createRedshiftReader, redshiftSql } from "./redshift";
import { readerDialectContract } from "./reader-contract";
import { ModelDefinition } from "./schema";
import type { SourceRecord } from "./types";
import { losslessTypes } from "./postgres";

const pg = vi.hoisted(() => ({ Client: vi.fn() }));
vi.mock("pg", async original => ({ ...(await original<typeof import("pg")>()), Client: pg.Client }));
afterEach(() => vi.resetAllMocks());
const config = { host: "test.redshift.amazonaws.com", database: "test", username: "reader", password: "secret" };
const fields = [
  { name: "id", dataTypeID: 1043 },
  { name: "updated", dataTypeID: 1700 },
  { name: "deleted", dataTypeID: 16 },
];
function fixture(pages: any[][][] = [], metadata = fields) {
  const client = {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    on: vi.fn(),
    query: vi.fn(async ({ text }: { text: string }) => {
      if (text.includes("LIMIT 0")) return { fields: metadata, rows: [] };
      if (text.startsWith("FETCH"))
        return { fields: [...metadata, { name: "__jitsu_retl_key_count", dataTypeID: 20 }], rows: pages.shift() ?? [] };
      if (text.includes("LIMIT 101")) return { fields: metadata, rows: pages.shift() ?? [] };
      return { fields: [], rows: [] };
    }),
  };
  pg.Client.mockImplementation(function () {
    return client;
  });
  return client;
}
readerDialectContract("Redshift", redshiftSql, { key: "1043", number: "1700", timestamp: "1184", structured: "4000" });

it.each(['{"name":"Alice","id":9007199254740993}', '[true,null,{"x":1}]', '"hello"', "null", null])(
  "decodes SUPER %s in preview and extraction without parsing VARCHAR",
  async payload => {
    const metadata = [
      { name: "id", dataTypeID: 20 },
      { name: "payload", dataTypeID: 4000 },
      { name: "text", dataTypeID: 1043 },
    ];
    const values = ["9007199254740993", payload, payload];
    fixture([[values], [[...values, "1"]]], metadata);
    const reader = createRedshiftReader(config);
    try {
      const model = ModelDefinition.parse({ warehouseId: "wh", query: "SELECT * FROM source", primaryKey: ["id"] });
      const preview = await reader.preview(model.query);
      expect(preview.rows).toEqual([
        { id: values[0], payload: payload === null ? null : JSON.parse(payload), text: payload },
      ]);
      const records: SourceRecord[] = [];
      for await (const record of reader.stream(model)) records.push(record);
      expect(records[0].row).toEqual(preview.rows[0]);
    } finally {
      await reader.close();
    }
  }
);

async function tombstoneRecords(value: unknown, oid = 1700, checkpoint = false) {
  fixture(
    [[["a", "1", value, "1"]]],
    fields.map(field => (field.name === "deleted" ? { ...field, dataTypeID: oid } : field))
  );
  const reader = createRedshiftReader(config);
  try {
    const records: SourceRecord[] = [];
    for await (const record of reader.stream(
      ModelDefinition.parse({
        warehouseId: "wh",
        query: "SELECT id, updated, deleted FROM source",
        deleteColumn: "deleted",
        primaryKey: checkpoint ? ["id", "deleted"] : ["id"],
        ...(checkpoint ? { cursor: { column: "deleted", type: "number" } } : {}),
      })
    ))
      records.push(record);
    return records;
  } finally {
    await reader.close();
  }
}
it.each([
  ["0.00", false],
  ["1.00", true],
  ["-0.000", false],
  ["+1.0", true],
  ["1e0", true],
  ["10e-1", true],
  ["0e1000", false],
] as const)("decodes decimal tombstone %s without rewriting payloads or checkpoints", async (value, deleted) => {
  const decoded = losslessTypes.getTypeParser(1700, "text")(value);
  const [record] = await tombstoneRecords(decoded, 1700, true);
  expect(record.deleted).toBe(deleted);
  expect(record.row.deleted).toBe(value);
  expect(record.checkpoint).toEqual({ value, primaryKeyValues: ["a", value] });
});
it.each(["1.00000000000000000001", "0.00000000000000000001", "2.00", "-1.00", "1e-1000", "NaN"])(
  "rejects numeric tombstone %s without rounding",
  async value => {
    await expect(tombstoneRecords(value)).rejects.toThrow(/0\/1/);
  }
);
it.each([25, 1042, 1043])("does not normalize decimal-looking text for OID %s", async oid => {
  await expect(tombstoneRecords("1.00", oid)).rejects.toThrow(/0\/1/);
});
it("keeps null numeric and boolean tombstone behavior", async () => {
  expect((await tombstoneRecords(null))[0].deleted).toBe(false);
  expect((await tombstoneRecords(true, 16))[0].deleted).toBe(true);
});
it("uses verified TLS and read-only transaction, fetches one result and preserves exact checkpoints", async () => {
  const client = fixture([[["a", "9007199254740993", false, "1"]], [["b", "9007199254740994", true, "1"]]]);
  const reader = createRedshiftReader(config);
  const model = ModelDefinition.parse({
    warehouseId: "wh",
    query: "SELECT id, updated, deleted FROM source",
    primaryKey: ["id"],
    cursor: { column: "updated", type: "number" },
    deleteColumn: "deleted",
    pageSize: 1,
  });
  const records: SourceRecord[] = [];
  for await (const row of reader.stream(model, { value: "9007199254740992", primaryKeyValues: ["prior"] }))
    records.push(row);
  expect(records.map(row => row.checkpoint?.value)).toEqual(["9007199254740993", "9007199254740994"]);
  expect(records[1].deleted).toBe(true);
  expect(client.query.mock.calls[0][0].text).toBe("BEGIN READ ONLY");
  expect(pg.Client.mock.calls[0][0]).toMatchObject({ port: 5439, ssl: { rejectUnauthorized: true } });
  const queries = client.query.mock.calls.map(call => call[0]);
  expect(queries.filter(q => q.text.startsWith("DECLARE"))).toHaveLength(1);
  expect(queries.find(q => q.text.startsWith("DECLARE"))).toMatchObject({ values: ["9007199254740992", "prior"] });
  expect(queries.filter(q => q.text.startsWith("FETCH"))).toHaveLength(3);
  expect(client.end).toHaveBeenCalled();
  await reader.close();
});
it("quotes the default schema and bounds previews", async () => {
  const client = fixture([Array.from({ length: 101 }, (_, i) => [String(i), "1", false])]);
  const reader = createRedshiftReader({ ...config, defaultSchema: 'schema"name' });
  const preview = await reader.preview("SELECT id, updated, deleted FROM source");
  expect(preview.rows).toHaveLength(100);
  expect(preview.truncated).toBe(true);
  expect(client.query.mock.calls.some(call => call[0].text === 'SET search_path TO "schema""name"')).toBe(true);
  await reader.close();
});
it("caps FETCH size for single-node Redshift clusters", async () => {
  const client = fixture();
  const reader = createRedshiftReader(config);
  for await (const _ of reader.stream(
    ModelDefinition.parse({ warehouseId: "wh", query: "SELECT id FROM source", primaryKey: ["id"], pageSize: 10_000 })
  )) {
    /* consume */
  }
  expect(client.query.mock.calls.some(call => call[0].text === "FETCH FORWARD 1000 FROM jitsu_model")).toBe(true);
  await reader.close();
});
it("accepts the console's legacy uppercase PUBLIC default", async () => {
  const client = fixture();
  const reader = createRedshiftReader({ ...config, defaultSchema: "PUBLIC" });
  await reader.columns("SELECT id FROM source");
  expect(client.query.mock.calls.some(call => call[0].text === 'SET search_path TO "public"')).toBe(true);
  await reader.close();
});
it("rejects IAM without falling back to process credentials", () => {
  expect(() => createRedshiftReader({ ...config, authenticationMethod: "iam" })).toThrow();
  expect(pg.Client).not.toHaveBeenCalled();
});
it("rejects duplicate keys and closes the dedicated connection", async () => {
  const client = fixture([[["a", "1", false, "2"]]]);
  const reader = createRedshiftReader(config);
  await expect(async () => {
    for await (const _ of reader.stream(
      ModelDefinition.parse({ warehouseId: "wh", query: "SELECT id, updated, deleted FROM source", primaryKey: ["id"] })
    )) {
      /* consume */
    }
  }).rejects.toThrow(/duplicate/);
  expect(client.end).toHaveBeenCalled();
  await reader.close();
});
it("close cancels a stalled read", async () => {
  const client = fixture();
  client.query.mockImplementation(() => new Promise(() => {}));
  const reader = createRedshiftReader(config);
  const pending = reader.preview("SELECT id FROM source");
  await vi.waitFor(() => expect(client.query).toHaveBeenCalled());
  const rejected = expect(pending).rejects.toThrow();
  await reader.close();
  await rejected;
  expect(client.end).toHaveBeenCalled();
});
