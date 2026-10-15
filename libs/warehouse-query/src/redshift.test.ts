import { afterEach, expect, it, vi } from "vitest";
import { createRedshiftReader, redshiftSql } from "./redshift";
import { readerDialectContract } from "./reader-contract";
import { ModelDefinition } from "./schema";
import type { SourceRecord } from "./types";

const pg = vi.hoisted(() => ({ Client: vi.fn() }));
vi.mock("pg", async original => ({ ...(await original<typeof import("pg")>()), Client: pg.Client }));
afterEach(() => vi.resetAllMocks());
const config = { host: "test.redshift.amazonaws.com", database: "test", username: "reader", password: "secret" };
const fields = [
  { name: "id", dataTypeID: 1043 },
  { name: "updated", dataTypeID: 1700 },
  { name: "deleted", dataTypeID: 16 },
];
function fixture(pages: any[][][] = []) {
  const client = {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    on: vi.fn(),
    query: vi.fn(async ({ text }: { text: string }) => {
      if (text.includes("LIMIT 0")) return { fields, rows: [] };
      if (text.startsWith("FETCH"))
        return { fields: [...fields, { name: "__jitsu_retl_key_count", dataTypeID: 20 }], rows: pages.shift() ?? [] };
      if (text.includes("LIMIT 101")) return { fields, rows: pages.shift() ?? [] };
      return { fields: [], rows: [] };
    }),
  };
  pg.Client.mockImplementation(function () {
    return client;
  });
  return client;
}
readerDialectContract("Redshift", redshiftSql, { key: "1043", number: "1700", timestamp: "1184", structured: "4000" });
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
