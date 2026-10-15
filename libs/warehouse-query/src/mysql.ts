import { createConnection, type FieldPacket } from "mysql2";
import { isIP } from "node:net";
import { Parser } from "node-sql-parser";
import { z } from "zod";
import { ModelDefinition, type WarehouseColumn } from "./schema";
import { createSqlDialect } from "./sql";
import { boundedPreview, decodeRecord } from "./reader";
import { StreamDeadline } from "./stream-deadline";
import { spoolJsonRows } from "./stream-spool";
import type { WarehouseReader } from "./types";

const credentials = z.object({
  authenticationMethod: z.literal("password").default("password"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(3306),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  parameters: z.object({ tls: z.enum(["true", "false", "skip-verify", "preferred"]).optional() }).optional(),
});
const numberType = /^(SIGNED|UNSIGNED|DECIMAL\(65,(?:[0-9]|[12][0-9]|30)\))$/;
const scalar = (type: string) => numberType.test(type) || /^(CHAR|DATE|DATETIME\(6\)|TIME\(6\))$/.test(type);
const parser = new Parser();
const dialect = createSqlDialect({
  parse: query => {
    // MySQL executes version comments, unlike ordinary SQL comments. Do not
    // permit hidden clauses that the AST validator cannot inspect.
    if (/\/\*!/.test(query)) throw new Error("Executable MySQL comments are not supported in model queries");
    return parser.astify(query, { database: "MySQL" });
  },
  lineCommentPrefixes: ["-- ", "--\t", "--\r", "--\n", "--\f", "--\v", "#"],
  backslashEscapes: (query, index) => query[index] !== "`",
  quoteColumn: name => "`" + name.replaceAll("`", "``") + "`",
  supportsPrimaryKeyType: scalar,
  supportsDeleteType: type => numberType.test(type) || type === "CHAR",
  supportsCursorType: (cursor, type) =>
    cursor === "number"
      ? numberType.test(type)
      : cursor === "string"
      ? type === "CHAR"
      : /^(DATE|DATETIME\(6\))$/.test(type),
  createParameters() {
    const queryParams: Record<string, string> = {};
    return {
      values: [],
      queryParams,
      bind(value, type, index) {
        if (!scalar(type)) throw new Error("Unsupported MySQL checkpoint type");
        const name = `jitsu_checkpoint_${index}`;
        queryParams[name] = value;
        return `CAST(:${name} AS ${type})`;
      },
    };
  },
  lookbackPredicate: (column, parameter, seconds) => `${column} >= DATE_SUB(${parameter}, INTERVAL ${seconds} SECOND)`,
});

// mysql2's named-placeholder converter does not understand comments/backticks.
// Convert only generated parameters outside MySQL literals, identifiers and
// comments, then send positional bindings through the server-prepared protocol.
export const mysqlSql: WarehouseReader["sql"] = {
  ...dialect,
  compileModel(model, columns, after) {
    const compiled = dialect.compileModel(model, columns, after);
    const source = compiled.query;
    let query = "";
    const values: string[] = [];
    for (let i = 0; i < source.length; ) {
      const start = i;
      const char = source[i];
      if (["'", '"', "`"].includes(char)) {
        for (i++; i < source.length; i++) {
          if (char !== "`" && source[i] === "\\") i++;
          else if (source[i] === char) {
            if (source[i + 1] === char) i++;
            else {
              i++;
              break;
            }
          }
        }
      } else if (char === "#" || (source.startsWith("--", i) && /[\s\x00-\x1f]/.test(source[i + 2] ?? ""))) {
        while (i < source.length && !["\n", "\r"].includes(source[i])) i++;
      } else if (source.startsWith("/*", i)) {
        const end = source.indexOf("*/", i + 2);
        i = end < 0 ? source.length : end + 2;
      } else {
        const parameter = source.slice(i).match(/^:(jitsu_checkpoint_\d+)\b/);
        if (parameter && Object.hasOwn(compiled.queryParams, parameter[1])) {
          values.push(compiled.queryParams[parameter[1]]);
          query += "?";
          i += parameter[0].length;
          continue;
        }
        i++;
      }
      query += source.slice(start, i);
    }
    return { query, values, queryParams: {} };
  },
};

/** SQL cast types are derived only from driver metadata, never user-provided SQL. */
export function mysqlColumns(fields: FieldPacket[]): WarehouseColumn[] {
  return fields.map(field => {
    const code = field.columnType ?? -1;
    let type = `MYSQL_TYPE_${code}`;
    if ([1, 2, 3, 8, 9, 13].includes(code)) type = Number(field.flags) & 32 ? "UNSIGNED" : "SIGNED";
    else if ([0, 246].includes(code) && field.decimals <= 30) type = `DECIMAL(65,${field.decimals})`;
    else if ([7, 12].includes(code)) type = "DATETIME(6)";
    else if ([10, 14].includes(code)) type = "DATE";
    else if (code === 11) type = "TIME(6)";
    else if ([15, 249, 250, 251, 252, 253, 254].includes(code) && field.characterSet !== 63) type = "CHAR";
    else if (code === 245) type = "JSON";
    return { name: field.name, type };
  });
}

export function createMySqlReader(input: Record<string, any>): WarehouseReader {
  const config = credentials.parse(input);
  // mysql2 omits the TLS verification hostname for IP literals. Fail before
  // authentication rather than verify against an unintended localhost default.
  if (isIP(config.host) && !["false", "skip-verify"].includes(config.parameters?.tls ?? "true"))
    throw new Error(
      "Verified MySQL TLS requires a DNS hostname, not an IP address; configure the certificate's hostname"
    );
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
    const connection = createConnection({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      // "preferred" is deliberately strict for reads: never silently downgrade TLS.
      ssl:
        config.parameters?.tls === "false"
          ? undefined
          : {
              rejectUnauthorized: config.parameters?.tls !== "skip-verify",
              verifyIdentity: config.parameters?.tls !== "skip-verify",
            },
      connectTimeout: 10_000,
      multipleStatements: false,
      namedPlaceholders: false,
      rowsAsArray: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: false,
      dateStrings: true,
      jsonStrings: true,
      timezone: "Z",
      charset: "utf8mb4",
    });
    connection.on("error", () => {});
    const abort = () => connection.destroy();
    deadline.signal.addEventListener("abort", abort, { once: true });
    const release = () => {
      deadline.close();
      abort();
      deadline.signal.removeEventListener("abort", abort);
      active.delete(controller);
    };
    const query = (sql: string) => deadline.read(() => connection.promise().query(sql));
    const execute = (sql: string) => deadline.read(() => connection.promise().execute<any[][]>(sql));
    try {
      const [version] = await query("SELECT VERSION()");
      const serverVersion = String((version as any[][])[0][0]);
      if (/mariadb/i.test(serverVersion) || Number.parseInt(serverVersion, 10) < 8)
        throw new Error("Reverse ETL requires MySQL 8.0 or later; MariaDB is not supported yet");
      await query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
      await query("SET time_zone = '+00:00'");
      await query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await query(`SET SESSION max_execution_time = ${streaming ? 7_200_000 : 30_000}`);
      await query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      return { connection, deadline, execute, release };
    } catch (error) {
      release();
      throw error;
    }
  }
  const rowOf = (fields: FieldPacket[], row: unknown[]) => Object.fromEntries(fields.map((f, i) => [f.name, row[i]]));
  return {
    sql: mysqlSql,
    async columns(query, signal) {
      const sql = mysqlSql.validateQuery(query);
      const s = await session(signal, false);
      try {
        const [, fields] = await s.execute(`SELECT * FROM (${sql}\n) AS model LIMIT 0`);
        return mysqlColumns(fields);
      } finally {
        s.release();
      }
    },
    async preview(query, signal) {
      const sql = mysqlSql.validateQuery(query);
      const s = await session(signal, false);
      try {
        const [rows, fields] = await s.execute(`SELECT * FROM (${sql}\n) AS model LIMIT 101`);
        return boundedPreview(
          mysqlColumns(fields),
          rows.map(row => rowOf(fields, row))
        );
      } finally {
        s.release();
      }
    },
    async *stream(input, after, signal) {
      const model = ModelDefinition.parse(input);
      const sql = mysqlSql.validateQuery(model.query);
      const s = await session(signal, true);
      try {
        const [, fields] = await s.execute(`SELECT * FROM (${sql}\n) AS model LIMIT 0`);
        const compiled = mysqlSql.compileModel(model, mysqlColumns(fields), after);
        // Prepared execution, not client-side '?' interpolation: literals must
        // remain untouched. Repeated checkpoints have positional bindings.
        const command = s.connection.execute({ sql: compiled.query, values: compiled.values });
        let resultFields: FieldPacket[] | undefined;
        // mysql2's event typing says FieldPacket, but the wire event is an array.
        command.on("fields", fields => {
          resultFields = fields as unknown as FieldPacket[];
        });
        const rows = command.stream({ highWaterMark: 16 });
        // Query execution starts before spoolJsonRows finishes async file setup.
        // Handle early errors now; the async iterator still rejects with them.
        rows.on("error", () => {});
        const cancelRows = () => rows.destroy();
        s.deadline.signal.addEventListener("abort", cancelRows, { once: true });
        async function* encoded() {
          const iterator = rows[Symbol.asyncIterator]();
          for (;;) {
            const result = await s.deadline.read(() => iterator.next());
            if (result.done) break;
            if (!resultFields) throw new Error("MySQL did not return query metadata");
            yield JSON.stringify(rowOf(resultFields, result.value));
          }
        }
        try {
          // Drain the socket before destination delivery can stall the consumer.
          // Re-querying pages would risk mixing warehouse snapshots.
          for await (const row of spoolJsonRows<Record<string, unknown>>(encoded(), s.deadline.signal))
            yield decodeRecord(model, row);
        } finally {
          s.deadline.signal.removeEventListener("abort", cancelRows);
          rows.destroy();
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
