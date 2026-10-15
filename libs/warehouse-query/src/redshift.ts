import { Client } from "pg";
import { Parser } from "node-sql-parser";
import { z } from "zod";
import { ModelDefinition } from "./schema";
import { createSqlDialect } from "./sql";
import { losslessTypes } from "./postgres";
import { boundedPreview, decodeRecord } from "./reader";
import { StreamDeadline } from "./stream-deadline";
import type { WarehouseReader } from "./types";

const credentials = z.object({
  authenticationMethod: z.literal("password").default("password"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(5439),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  defaultSchema: z.string().default("public"),
});
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const scalar = /^(16|20|21|23|25|700|701|1042|1043|1082|1083|1114|1184|1266|1700)$/;
const parser = new Parser();
export const redshiftSql = createSqlDialect({
  parse: query => parser.astify(query, { database: "Redshift" }),
  lineCommentPrefixes: ["--"],
  backslashEscapes: () => true,
  dollarQuote(query, index) {
    return query[index] === "$" ? query.slice(index).match(/^\$(?:[a-zA-Z_][\w]*)?\$/)?.[0] : undefined;
  },
  quoteColumn: quote,
  supportsPrimaryKeyType: type => scalar.test(type),
  supportsDeleteType: type => /^(16|20|21|23|25|700|701|1042|1043|1700)$/.test(type),
  supportsCursorType: (cursor, type) =>
    ({ timestamp: /^(1082|1114|1184)$/, number: /^(20|21|23|700|701|1700)$/, string: /^(25|1042|1043)$/ }[cursor].test(
      type
    )),
  createParameters() {
    const values: string[] = [];
    return {
      values,
      queryParams: {},
      bind(value) {
        values.push(value);
        return "$" + values.length;
      },
    };
  },
  lookbackPredicate: (column, parameter, seconds) =>
    `${column} >= DATEADD(second, -${seconds}, CAST(${parameter} AS TIMESTAMPTZ))`,
});

/** Redshift uses the PG wire format, not PostgreSQL's preview SQL or session options. */
export function createRedshiftReader(input: Record<string, any>): WarehouseReader {
  const config = credentials.parse(input);
  const active = new Set<AbortController>();
  let closed = false;
  async function session(parent: AbortSignal | undefined, streaming: boolean) {
    if (closed) throw new Error("Reader is closed");
    const controller = new AbortController();
    active.add(controller);
    const deadline = new StreamDeadline(
      AbortSignal.any([controller.signal, ...(parent ? [parent] : [])]),
      30_000,
      streaming ? 7_200_000 : 30_000
    );
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl: { rejectUnauthorized: true },
      connectionTimeoutMillis: 10_000,
      types: losslessTypes,
    });
    client.on("error", () => {});
    const abort = () => {
      void client.end().catch(() => {});
    };
    deadline.signal.addEventListener("abort", abort, { once: true });
    const release = async () => {
      deadline.close();
      deadline.signal.removeEventListener("abort", abort);
      active.delete(controller);
      await client.end().catch(() => {});
    };
    const query = (text: string, values: string[] = []) =>
      deadline.read(() => client.query({ text, values, rowMode: "array", types: losslessTypes }));
    try {
      await deadline.read(() => client.connect());
      await query("BEGIN READ ONLY");
      await query(`SET statement_timeout TO ${streaming ? 7_200_000 : 30_000}`);
      await query("SET timezone TO 'UTC'");
      await query("SET enable_case_sensitive_identifier TO true");
      // Console/Bulker historically store the built-in schema as uppercase PUBLIC.
      // Other names retain their spelling for explicitly case-sensitive schemas.
      await query(`SET search_path TO ${quote(config.defaultSchema === "PUBLIC" ? "public" : config.defaultSchema)}`);
      return { query, release };
    } catch (error) {
      await release();
      throw error;
    }
  }
  const columnsOf = (result: { fields: { name: string; dataTypeID: number }[] }) =>
    result.fields.map(field => ({ name: field.name, type: String(field.dataTypeID) }));
  const rowsOf = (result: { fields: { name: string }[]; rows: any[][] }) =>
    result.rows.map(row => Object.fromEntries(result.fields.map((field, index) => [field.name, row[index]])));
  return {
    sql: redshiftSql,
    async columns(query, signal) {
      const sql = redshiftSql.validateQuery(query);
      const s = await session(signal, false);
      try {
        return columnsOf(await s.query(`SELECT * FROM (${sql}\n) AS model LIMIT 0`));
      } finally {
        await s.release();
      }
    },
    async preview(query, signal) {
      const sql = redshiftSql.validateQuery(query);
      const s = await session(signal, false);
      try {
        const result = await s.query(`SELECT * FROM (${sql}\n) AS model LIMIT 101`);
        return boundedPreview(columnsOf(result), rowsOf(result));
      } finally {
        await s.release();
      }
    },
    async *stream(input, after, signal) {
      const model = ModelDefinition.parse(input);
      const sql = redshiftSql.validateQuery(model.query);
      const s = await session(signal, true);
      try {
        const columns = columnsOf(await s.query(`SELECT * FROM (${sql}\n) AS model LIMIT 0`));
        const compiled = redshiftSql.compileModel(model, columns, after);
        // One cursor/result in one read-only transaction. Redshift materializes
        // cursors on its leader node; cluster cursor limits still apply.
        await s.query(`DECLARE jitsu_model CURSOR FOR ${compiled.query}`, compiled.values);
        for (;;) {
          // Single-node Redshift clusters allow at most 1,000 rows per FETCH.
          const result = await s.query(`FETCH FORWARD ${Math.min(model.pageSize, 1_000)} FROM jitsu_model`);
          if (!result.rows.length) break;
          for (const row of rowsOf(result)) {
            signal?.throwIfAborted();
            yield decodeRecord(model, row);
          }
        }
      } finally {
        await s.release();
      }
    },
    async close() {
      closed = true;
      for (const controller of active) controller.abort();
      active.clear();
    },
  };
}
