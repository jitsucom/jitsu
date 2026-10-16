import { createPrivateKey } from "node:crypto";
import { Parser } from "node-sql-parser";
import { z } from "zod";
import type { Connection, RowStatement } from "snowflake-sdk";
import { ModelDefinition, WarehouseColumn } from "./schema";
import { createSqlDialect, decodeDelete, keyCountColumn } from "./sql";
import { boundedPreview, decodeRecord, previewRowLimit, previewByteLimit, previewSizeError } from "./reader";
import { StreamDeadline } from "./stream-deadline";
import type { WarehouseReader } from "./types";

const credentials = z.object({
  authenticationMethod: z.literal("key-pair"),
  account: z.string().regex(/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/),
  username: z.string().min(1),
  privateKey: z.string().min(1),
  privateKeyPassphrase: z.string().optional(),
  warehouse: z.string().min(1),
  database: z.string().min(1),
  defaultSchema: z.string().default("PUBLIC"),
  parameters: z.record(z.string()).optional(),
});
const scalar = /^(?:NUMBER\(\d+,\d+\)|REAL|TEXT|BOOLEAN|DATE|TIME|TIMESTAMP_NTZ|TIMESTAMP_LTZ|TIMESTAMP_TZ)$/;
// Use the same formats for output and checkpoint parsing, independent of inherited input settings.
const temporalFormats: Readonly<Record<string, string>> = {
  DATE: "YYYY-MM-DD",
  TIME: "HH24:MI:SS.FF9",
  TIMESTAMP_NTZ: "YYYY-MM-DD HH24:MI:SS.FF9",
  TIMESTAMP_LTZ: "YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM",
  TIMESTAMP_TZ: "YYYY-MM-DD HH24:MI:SS.FF9 TZH:TZM",
};
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const parser = new Parser();
export const snowflakeSql = createSqlDialect({
  parse: query => parser.astify(query, { database: "Snowflake" }),
  lineCommentPrefixes: ["--", "//"],
  backslashEscapes: (_query, index) => _query[index] === "'",
  dollarQuote: (query, index) => (query.startsWith("$$", index) ? "$$" : undefined),
  quoteColumn: quote,
  supportsPrimaryKeyType: type => scalar.test(type),
  supportsDeleteType: type => /^(?:NUMBER\(\d+,\d+\)|REAL|TEXT|BOOLEAN)$/.test(type),
  supportsCursorType: (cursor, type) =>
    ({
      timestamp: /^(DATE|TIMESTAMP_NTZ|TIMESTAMP_LTZ|TIMESTAMP_TZ)$/,
      number: /^(NUMBER\(\d+,\d+\)|REAL)$/,
      string: /^TEXT$/,
    }[cursor].test(type)),
  createParameters() {
    const values: string[] = [];
    return {
      values,
      queryParams: {},
      bind(value, type) {
        if (!scalar.test(type)) throw new Error("Unsupported Snowflake checkpoint type");
        values.push(value);
        if (temporalFormats[type]) return `TO_${type}(:${values.length}, '${temporalFormats[type]}')`;
        return `CAST(:${values.length} AS ${type})`;
      },
    };
  },
  lookbackPredicate: (column, parameter, seconds) => `${column} >= DATEADD(second, -${seconds}, ${parameter})`,
});

function columnsOf(statement: RowStatement): WarehouseColumn[] {
  const columns = statement.getColumns();
  if (!columns) throw new Error("Snowflake did not return query metadata");
  return columns.map(column => ({
    // QUOTED_IDENTIFIERS_IGNORE_CASE can uppercase our generated alias. Normalize
    // only this reserved name, also rejecting case variants in source metadata.
    name: column.getName().toLowerCase() === keyCountColumn ? keyCountColumn : column.getName(),
    type:
      column.getType() === "fixed"
        ? `NUMBER(${column.getPrecision()},${column.getScale()})`
        : column.getType().toUpperCase(),
  }));
}

/** Serialize in Snowflake: SDK string fetching still parses typed containers first. */
function losslessQuery(query: string, columns: WarehouseColumn[], order: string[] = []): string {
  if (!columns.some(column => /^(OBJECT|ARRAY|MAP)$/.test(column.type))) return query;
  if (new Set(columns.map(column => column.name)).size !== columns.length)
    throw new Error("Query returns duplicate column names; use unique aliases");
  return `SELECT ${columns
    .map(column => {
      const name = quote(column.name);
      return /^(OBJECT|ARRAY|MAP)$/.test(column.type) ? `TO_JSON(TO_VARIANT(${name})) AS ${name}` : name;
    })
    .join(", ")} FROM (${query}\n) AS lossless_model${
    order.length ? ` ORDER BY ${order.map(name => `${quote(name)} ASC`).join(", ")}` : ""
  }`;
}

/** Recognize exact numeric 0/1 without rounding decimal strings through Number. */
function numericDeleteValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match || !(match[2] || match[3])) return value;
  const fraction = match[3] ?? "";
  const digits = (match[2] + fraction).replace(/^0+/, "");
  if (!digits) return false;
  const significant = digits.replace(/0+$/, "");
  if (
    match[1] !== "-" &&
    significant === "1" &&
    BigInt(match[4] ?? "0") + BigInt(digits.length - significant.length) === BigInt(fraction.length)
  )
    return true;
  return value;
}

export function createSnowflakeReader(input: Record<string, any>): WarehouseReader {
  const config = credentials.parse(input);
  // Convert encrypted keys locally; never pass arbitrary saved parameters as SDK
  // options (they could override authentication, endpoint or TLS policy).
  const key = createPrivateKey({ key: config.privateKey, passphrase: config.privateKeyPassphrase });
  if (key.asymmetricKeyType !== "rsa") throw new Error("Snowflake requires an RSA private key");
  const privateKey = key.export({ type: "pkcs8", format: "pem" }).toString();
  const active = new Set<AbortController>();
  let closed = false;
  async function session(parent: AbortSignal | undefined, streaming: boolean) {
    if (closed) throw new Error("Reader is closed");
    const controller = new AbortController();
    active.add(controller);
    const deadline = new StreamDeadline(
      AbortSignal.any([controller.signal, ...(parent ? [parent] : [])]),
      30_000,
      streaming ? 2 * 60 * 60 * 1000 : 30_000
    );
    let connection: Connection | undefined;
    let current: RowStatement | undefined;
    let rows: ReturnType<RowStatement["streamRows"]> | undefined;
    const abort = () => {
      rows?.destroy();
      try {
        current?.cancel(() => {});
      } catch {
        /* Connection may already be closed. */
      }
      try {
        connection?.destroy(() => {});
      } catch {
        /* Best effort; statement timeout is the backstop. */
      }
    };
    deadline.signal.addEventListener("abort", abort, { once: true });
    const release = () => {
      deadline.close();
      deadline.signal.removeEventListener("abort", abort);
      active.delete(controller);
    };
    try {
      const { default: sdk } = await deadline.read(() => import("snowflake-sdk"));
      deadline.signal.throwIfAborted();
      // SDK warnings can contain raw warehouse values, even with fetchAsString.
      // Keep errors on the reader's normal rejection path, not SDK stdout/files.
      sdk.configure({ logLevel: "OFF" });
      connection = sdk.createConnection({
        // SDK 3.4.0 treats an explicit empty path as no Easy Logging config;
        // otherwise a host config file can re-enable logging during connect.
        clientConfigFile: "",
        account: config.account,
        username: config.username,
        authenticator: "SNOWFLAKE_JWT",
        privateKey,
        warehouse: config.warehouse,
        database: config.database,
        schema: config.defaultSchema,
        role: config.parameters?.role,
        clientSessionKeepAlive: false,
        representNullAsStringNull: false,
        timeout: 30_000,
      });
      await deadline.read(
        () =>
          new Promise<void>((resolve, reject) =>
            connection!.connect(error => {
              if (deadline.signal.aborted) {
                abort();
                reject(deadline.signal.reason);
              } else if (error) reject(error);
              else resolve();
            })
          )
      );
      const execute = async (sqlText: string, binds: string[] = []) => {
        // SDK progress polling happens before complete(), even with streamResult.
        // A running/queued query is not a stalled row read; keep the overall limit.
        current = await deadline.wait(
          () =>
            new Promise<RowStatement>((resolve, reject) => {
              current = connection!.execute({
                sqlText,
                binds,
                streamResult: true,
                rowMode: "array",
                fetchAsString: ["Number", "Date", "JSON"],
                parameters: {
                  MULTI_STATEMENT_COUNT: 1,
                  STATEMENT_TIMEOUT_IN_SECONDS: streaming ? 7200 : 30,
                  TIMEZONE: "UTC",
                  TIME_OUTPUT_FORMAT: temporalFormats.TIME,
                  TIMESTAMP_NTZ_OUTPUT_FORMAT: temporalFormats.TIMESTAMP_NTZ,
                  TIMESTAMP_LTZ_OUTPUT_FORMAT: temporalFormats.TIMESTAMP_LTZ,
                  TIMESTAMP_TZ_OUTPUT_FORMAT: temporalFormats.TIMESTAMP_TZ,
                  DATE_OUTPUT_FORMAT: temporalFormats.DATE,
                },
                complete(error, statement) {
                  if (error) reject(error);
                  else resolve(statement);
                },
              });
            })
        );
        return current;
      };
      async function* read(statement: RowStatement) {
        const columns = columnsOf(statement);
        rows = statement.streamRows();
        const iterator = rows[Symbol.asyncIterator]();
        try {
          for (;;) {
            const result = await deadline.read(() => iterator.next());
            if (result.done) break;
            const values = result.value as unknown[];
            if (!Array.isArray(values) || values.length !== columns.length)
              throw new Error("Snowflake row does not match its schema");
            yield Object.fromEntries(columns.map((column, index) => [column.name, values[index]]));
          }
        } finally {
          rows.destroy();
          rows = undefined;
        }
      }
      return { execute, read, release };
    } catch (error) {
      release();
      throw error;
    }
  }
  return {
    sql: snowflakeSql,
    async columns(query, signal) {
      const sql = snowflakeSql.validateQuery(query);
      const s = await session(signal, false);
      try {
        return columnsOf(await s.execute(`SELECT * FROM (${sql}\n) AS model LIMIT 0`));
      } finally {
        s.release();
      }
    },
    async preview(query, signal) {
      const sql = snowflakeSql.validateQuery(query);
      const s = await session(signal, false);
      try {
        const columns = columnsOf(await s.execute(`SELECT * FROM (${sql}\n) AS model LIMIT 0`));
        const statement = await s.execute(
          `SELECT * FROM (${losslessQuery(sql, columns)}\n) AS model LIMIT ${previewRowLimit + 1}`
        );
        const rows: Record<string, unknown>[] = [];
        let bytes = 0;
        for await (const row of s.read(statement)) {
          bytes += Buffer.byteLength(JSON.stringify(row));
          if (bytes > previewByteLimit) throw new Error(previewSizeError);
          rows.push(row);
        }
        return boundedPreview(columns, rows);
      } finally {
        s.release();
      }
    },
    async *stream(input, after, signal) {
      const model = ModelDefinition.parse(input);
      const sql = snowflakeSql.validateQuery(model.query);
      const s = await session(signal, true);
      try {
        const columns = columnsOf(await s.execute(`SELECT * FROM (${sql}\n) AS model LIMIT 0`));
        // Validate the original query and types; generated projection SQL only
        // contains quoted metadata names, never an unparsed user-query fallback.
        const compiled = snowflakeSql.compileModel(model, columns, after);
        const query = losslessQuery(
          compiled.query,
          [...columns, { name: keyCountColumn, type: "NUMBER(38,0)" }],
          model.cursor ? [model.cursor.column, ...model.primaryKey] : model.primaryKey
        );
        const statement = await s.execute(query, compiled.values);
        const numericDelete = /^(NUMBER\(\d+,\d+\)|REAL)$/.test(
          columns.find(c => c.name === model.deleteColumn)?.type ?? ""
        );
        for await (const row of s.read(statement)) {
          const record = decodeRecord({ ...model, deleteColumn: undefined }, row);
          if (model.deleteColumn) {
            const value = row[model.deleteColumn];
            record.deleted = decodeDelete(numericDelete ? numericDeleteValue(value) : value);
          }
          yield record;
        }
      } finally {
        s.release();
      }
    },
    async close() {
      closed = true;
      for (const controller of active) controller.abort();
      active.clear();
    },
  };
}
