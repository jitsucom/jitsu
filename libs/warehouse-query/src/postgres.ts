import { Client, types } from "pg";
import Cursor from "pg-cursor";
import { z } from "zod";
import { Parser } from "node-sql-parser";
import { ModelDefinition } from "./schema";
import { createSqlDialect } from "./sql";
import { boundedPreview, decodeRecord, previewByteLimit, previewRowLimit, previewSizeError } from "./reader";
import type { WarehouseReader } from "./types";
const pgCredentials = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(5432),
  database: z.string().min(1),
  username: z.string().default("postgres"),
  password: z.string().optional(),
  sslMode: z.enum(["disable", "require", "verify-ca", "verify-full"]).default("require"),
  sslServerCA: z.string().optional(),
  sslClientCert: z.string().optional(),
  sslClientKey: z.string().optional(),
  defaultSchema: z.string().default("public"),
});
/**
 * Preserve exact wire text for INT8 (20), NUMERIC (1700), DATE (1082),
 * TIMESTAMP (1114) and TIMESTAMPTZ (1184). JS numbers cannot represent every
 * bigint/decimal, and pg's Date decoding loses timestamp microseconds and can
 * apply the process timezone. Models need exact keys, checkpoint values and
 * destination payloads across reads/resumes, so these values stay strings.
 * Keep the override local to this reader and pass it to both Client and Cursor:
 * pg-cursor owns its result decoding too. Other types use pg's normal parsers.
 */
export const losslessTypes = {
  getTypeParser(oid: number, format?: string) {
    if ([20, 1700, 1082, 1114, 1184].includes(oid)) return (value: string) => value;
    return types.getTypeParser(oid, format as "text");
  },
};

const parser = new Parser();
export const postgresSql = createSqlDialect({
  parse: query => parser.astify(query, { database: "Postgresql" }),
  lineCommentPrefixes: ["--"],
  backslashEscapes: (query, i) =>
    query[i] === "'" && /[eE]/.test(query[i - 1] ?? "") && !/[\w$\u0080-\uFFFF]/.test(query[i - 2] ?? ""),
  dollarQuote(query, i) {
    if (query[i] === "$" && !/[\w$\u0080-\uFFFF]/.test(query[i - 1] ?? ""))
      return query.slice(i).match(/^\$(?:[a-zA-Z_\u0080-\uFFFF][\w\u0080-\uFFFF]*)?\$/)?.[0];
  },
  quoteColumn: name => '"' + name.replaceAll('"', '""') + '"',
  // Known OIDs decoded as string/number/boolean by losslessTypes and pg's text
  // parsers. Fail closed for custom/structured types; SQL can cast them to text.
  supportsPrimaryKeyType: type =>
    /^(16|18|19|20|21|23|25|26|700|701|1042|1043|1082|1083|1114|1184|1266|1700|2950)$/.test(type),
  // Boolean and numeric/text 0/1 representations. Metadata cannot prove values;
  // decodeDelete still rejects anything other than true/false, 0/1 or null.
  supportsDeleteType: type => /^(16|18|19|20|21|23|25|26|700|701|1042|1043|1700)$/.test(type),
  supportsCursorType(cursorType, warehouseType) {
    return {
      timestamp: /^(1082|1114|1184)$/,
      number: /^(20|21|23|700|701|1700)$/,
      string: /^(25|1042|1043|2950)$/,
    }[cursorType].test(warehouseType);
  },
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
    column + " >= (" + parameter + "::timestamp with time zone - INTERVAL '" + seconds + " seconds')",
});

/** Internal preview projection; sql must already have passed postgresSql.validateQuery. */
export function compilePostgresPreview(sql: string, columnCount: number) {
  const fields = Array.from({ length: columnCount }, (_, i) => `c${i}`);
  // Materialize once so volatile SELECT expressions cannot differ between sizing
  // and delivery. record_out uses native text output, not JSON casts that could
  // hide large wire values. Sizing happens in Postgres; row 101 is only a marker.
  return {
    text: `WITH preview_source(n${fields.map(f => `, ${f}`).join("")}) AS MATERIALIZED (
      SELECT pg_catalog.row_number() OVER (), model.* FROM (${sql}\n) AS model LIMIT ${previewRowLimit + 1}
    ), preview_sized AS MATERIALIZED (
      SELECT *, pg_catalog.sum(CASE WHEN n <= ${previewRowLimit}
        THEN pg_catalog.octet_length(pg_catalog.record_out(ROW(${fields.join(", ")}))::pg_catalog.text)::bigint
        ELSE 0 END) OVER () > $1 AS oversized
      FROM preview_source
    ) SELECT n, oversized${fields
      .map(f => `, CASE WHEN n <= ${previewRowLimit} AND NOT oversized THEN ${f} END AS ${f}`)
      .join("")}
      FROM preview_sized ORDER BY n`,
    values: [previewByteLimit],
    rowMode: "array" as const,
  };
}

export function createPostgresReader(input: Record<string, any>): WarehouseReader {
  const config = pgCredentials.parse(input);
  const clients = new Set<Client>();
  let closed = false;
  async function connect(signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (closed) throw new Error("Reader is closed");
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      ssl:
        config.sslMode === "disable"
          ? false
          : {
              rejectUnauthorized: config.sslMode !== "require",
              ca: config.sslServerCA,
              cert: config.sslClientCert,
              key: config.sslClientKey,
              ...(config.sslMode === "verify-ca" ? { checkServerIdentity: () => undefined } : {}),
            },
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
      types: losslessTypes,
      options: "-c default_transaction_read_only=on -c timezone=UTC -c standard_conforming_strings=on",
    });
    clients.add(client);
    // Terminating our dedicated connection cancels an active server query, including
    // an in-flight cursor read. Never cancel a pooled connection owned by another run.
    const abort = () => {
      void client.end().catch(() => {});
    };
    signal?.addEventListener("abort", abort, { once: true });
    client.on("error", () => {}); // active query promises still reject
    const release = async () => {
      signal?.removeEventListener("abort", abort);
      clients.delete(client);
      await client.end().catch(() => {});
    };
    try {
      await client.connect();
      signal?.throwIfAborted();
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SELECT set_config('search_path', quote_ident($1), true)", [config.defaultSchema]);
      return { client, release };
    } catch (e) {
      await release();
      throw e;
    }
  }
  async function probe(client: Client, query: string) {
    const result = await client.query(`SELECT * FROM (${query}\n) AS model LIMIT 0`);
    return result.fields.map(f => ({ name: f.name, type: String(f.dataTypeID) }));
  }
  return {
    sql: postgresSql,
    async columns(query, signal) {
      const sql = postgresSql.validateQuery(query);
      const { client, release } = await connect(signal);
      try {
        return await probe(client, sql);
      } finally {
        await release();
      }
    },
    async preview(query, signal) {
      const sql = postgresSql.validateQuery(query);
      const { client, release } = await connect(signal);
      try {
        const columns = await probe(client, sql);
        // The server guards the complete result before pg can decode any payload.
        const result = await client.query(compilePostgresPreview(sql, columns.length));
        signal?.throwIfAborted();
        if (result.rows.some(row => row[1])) throw new Error(previewSizeError);
        const rows = result.rows.map(row =>
          Number(row[0]) > previewRowLimit ? {} : Object.fromEntries(columns.map((c, i) => [c.name, row[i + 2]]))
        );
        return boundedPreview(columns, rows);
      } finally {
        await release();
      }
    },
    async *stream(input, after, signal) {
      const model = ModelDefinition.parse(input);
      const sql = postgresSql.validateQuery(model.query);
      const { client, release } = await connect(signal);
      try {
        const columns = await probe(client, sql);
        const compiled = postgresSql.compileModel(model, columns, after);
        const cursor = client.query(new Cursor(compiled.query, compiled.values, { types: losslessTypes }));
        while (true) {
          signal?.throwIfAborted();
          const rows = await cursor.read(model.pageSize);
          if (!rows.length) break;
          for (const row of rows) {
            signal?.throwIfAborted();
            yield decodeRecord(model, row);
          }
        }
      } finally {
        // This dedicated connection owns the transaction and portal. Closing it
        // releases both; cursor.close() would wait forever after a socket abort.
        await release();
      }
    },
    async close() {
      closed = true;
      await Promise.all([...clients].map(c => c.end().catch(() => {})));
      clients.clear();
    },
  };
}
