import { afterEach, expect, it, vi } from "vitest";
import type { FieldPacket } from "mysql2";
import { Readable } from "node:stream";
import { createMySqlReader, mysqlColumns, mysqlSql } from "./mysql";
import { readerDialectContract } from "./reader-contract";
import { ModelDefinition, supportsWarehouseReader } from "./schema";

const mysql = vi.hoisted(() => ({ createConnection: vi.fn() }));
vi.mock("mysql2", async original => ({ ...(await original<typeof import("mysql2")>()), ...mysql }));
afterEach(() => vi.resetAllMocks());
readerDialectContract("MySQL", mysqlSql, {
  key: "CHAR",
  number: "DECIMAL(65,0)",
  timestamp: "DATETIME(6)",
  structured: "JSON",
});
it.each([
  "SELECT 1 INTO OUTFILE '/tmp/result'",
  "SELECT * FROM source FOR UPDATE",
  "SELECT 1 /*! INTO OUTFILE '/tmp/result' */",
])("rejects write-capable MySQL syntax: %s", query => expect(() => mysqlSql.validateQuery(query)).toThrow());
it("derives safe cast types without losing integer, decimal or time precision", () => {
  const field = (columnType: number, extra = {}) =>
    ({ name: "id", columnType, flags: 0, characterSet: 45, decimals: 0, ...extra } as FieldPacket);
  expect(
    mysqlColumns([
      field(8),
      field(8, { flags: 32 }),
      field(246, { decimals: 30 }),
      field(12),
      field(253),
      field(253, { characterSet: 63 }),
      field(245),
      field(5),
    ]).map(f => f.type)
  ).toEqual(["SIGNED", "UNSIGNED", "DECIMAL(65,30)", "DATETIME(6)", "CHAR", "MYSQL_TYPE_253", "JSON", "MYSQL_TYPE_5"]);
});
const config = { host: "test", username: "reader", password: "secret", database: "test" };
function fixture() {
  const query = vi.fn(async (_sql: string) => [[["8.4.0"]], []]);
  const execute = vi.fn(async () => [[], []]);
  const connection = { on: vi.fn(), destroy: vi.fn(), promise: () => ({ query, execute }) };
  mysql.createConnection.mockReturnValue(connection);
  return { ...connection, query, execute };
}
it.each([undefined, "preferred", "true", "false", "skip-verify"])(
  "honors explicit TLS policy (%s) without forwarding extra options",
  async tls => {
    const client = fixture();
    const reader = createMySqlReader({ ...config, parameters: { tls, multipleStatements: "true", host: "evil" } });
    await reader.columns("SELECT 1 AS id");
    expect(mysql.createConnection.mock.calls[0][0]).toMatchObject({
      host: "test",
      multipleStatements: false,
      bigNumberStrings: true,
      dateStrings: true,
      decimalNumbers: false,
    });
    expect(mysql.createConnection.mock.calls[0][0].ssl).toEqual(
      tls === "false" ? undefined : { rejectUnauthorized: tls !== "skip-verify", verifyIdentity: tls !== "skip-verify" }
    );
    expect(client.query.mock.calls.map(c => c[0])).toContain("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    expect(client.destroy).toHaveBeenCalled();
    await reader.close();
  }
);
it("cancels stalled reads when closed", async () => {
  const client = fixture();
  client.execute.mockImplementation(() => new Promise(() => {}));
  const reader = createMySqlReader(config);
  const pending = reader.preview("SELECT 1 AS id");
  await vi.waitFor(() => expect(client.execute).toHaveBeenCalled());
  const rejected = expect(pending).rejects.toThrow();
  await reader.close();
  await rejected;
  expect(client.destroy).toHaveBeenCalled();
});
it("advertises password auth only", () => {
  expect(supportsWarehouseReader({ destinationType: "mysql" })).toBe(true);
  expect(supportsWarehouseReader({ destinationType: "mysql", authenticationMethod: "iam" })).toBe(false);
  expect(() => createMySqlReader({ ...config, authenticationMethod: "iam" })).toThrow();
});
it.each(["127.0.0.1", "::1"])(
  "rejects IP literals before authentication when TLS identity verification is enabled (%s)",
  host => {
    expect(() => createMySqlReader({ ...config, host })).toThrow(/DNS hostname/);
    expect(mysql.createConnection).not.toHaveBeenCalled();
  }
);
it("only binds generated parameters, preserving comments, literals and backtick names", () => {
  const result = mysqlSql.compileModel(
    ModelDefinition.parse({
      warehouseId: "wh",
      query: "SELECT 'a' AS `id:source`, 2 AS updated, ':jitsu_checkpoint_0 ?' AS text_value /* source:prod ? */",
      primaryKey: ["id:source"],
      cursor: { column: "updated", type: "number" },
    }),
    [
      { name: "id:source", type: "CHAR" },
      { name: "updated", type: "SIGNED" },
    ],
    { value: "1", primaryKeyValues: ["a"] }
  );
  expect(result.query).toContain("`id:source`");
  expect(result.query).toContain("':jitsu_checkpoint_0 ?'");
  expect(result.query).toContain("/* source:prod ? */");
  expect(result.values).toEqual(["1", "1", "a"]);
  expect(result.query).toContain("`id:source` > ?");
  expect(result.query).not.toContain("AS CHAR");
  expect(result.query).toContain("CAST(? AS SIGNED)");
  expect(mysqlSql.validateQuery("SELECT 1--1 AS id;")).toBe("SELECT 1--1 AS id");
});
it("propagates query failures arriving before spool file initialization without an unhandled error", async () => {
  const client = fixture();
  client.execute.mockResolvedValue([[], [{ name: "id", columnType: 253, characterSet: 45 } as never]]);
  const rows = new Readable({ objectMode: true, read() {} });
  const command = {
    on: vi.fn(),
    stream: () => {
      process.nextTick(() => rows.destroy(new Error("early query failure")));
      return rows;
    },
  };
  mysql.createConnection.mockReturnValue({ ...client, execute: () => command });
  const reader = createMySqlReader(config);
  await expect(async () => {
    for await (const _ of reader.stream(
      ModelDefinition.parse({ warehouseId: "wh", query: "SELECT id FROM source", primaryKey: ["id"] })
    )) {
      /* consume */
    }
  }).rejects.toThrow("early query failure");
  expect(client.destroy).toHaveBeenCalled();
  await reader.close();
});
