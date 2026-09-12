import { createClient } from "@clickhouse/client";
import { z } from "zod";
import { Parser } from "node-sql-parser";
import { ModelDefinition } from "./schema";
import { createSqlDialect } from "./sql";
import { boundedPreview, decodeRecord } from "./reader";
import type { WarehouseReader } from "./types";
const chCredentials = z.object({
  protocol: z.enum(["http", "https"]),
  hosts: z.array(z.string().min(1)).min(1),
  database: z.string().default("default"),
  username: z.string().default("default"),
  password: z.string(),
});

// LowCardinality is a storage encoding, not part of the bound scalar value.
function unwrapLowCardinality(type: string): string {
  return type.replace(/^LowCardinality\((.*)\)$/, "$1");
}

const checkpointScalarType =
  /^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|String|FixedString\([1-9]\d*\)|UUID|Date|Date32|DateTime(?:\('[A-Za-z0-9_/+-]+'\))?|DateTime64\(\d+(?:,\s*'[A-Za-z0-9_/+-]+')?\)|Decimal(?:32|64|128|256)?\(\d+(?:,\s*\d+)?\))$/;

/** Shared by save-time validation and binding; never interpolate unchecked metadata. */
function checkpointType(type: string): string {
  const parameterType = unwrapLowCardinality(type);
  const scalar = parameterType.replace(/^Nullable\((.*)\)$/, "$1");
  if (!checkpointScalarType.test(scalar)) {
    throw new Error("Unsupported checkpoint type: " + type);
  }
  return parameterType;
}

const parser = new Parser();
export const clickhouseSql = createSqlDialect({
  // node-sql-parser 5.4.0 has no ClickHouse dialect. Accept its portable MySQL
  // SELECT subset; never fall back to executing SQL that could not be parsed.
  parse: query => parser.astify(query, { database: "MySQL" }),
  lineCommentPrefixes: ["--", "#"],
  backslashEscapes: () => true,
  quoteColumn: name => "`" + name.replaceAll("\\", "\\\\").replaceAll("`", "``") + "`",

  supportsPrimaryKeyType(type) {
    const scalar = unwrapLowCardinality(type).replace(/^Nullable\((.*)\)$/, "$1");
    // JSON scalar decoding is broader than safe checkpoint binding. Enum and
    // timestamp timezone metadata is only classified here, never interpolated.
    return (
      checkpointScalarType.test(scalar) ||
      /^(?:Bool|IPv4|IPv6|Enum(?:8|16)\(.*\)|DateTime\('[^']+'\)|DateTime64\(\d+,\s*'[^']+'\))$/s.test(scalar)
    );
  },

  supportsCursorType(cursorType, warehouseType) {
    const unwrapped = unwrapLowCardinality(warehouseType).replace(/^Nullable\((.*)\)$/, "$1");
    return {
      timestamp: /^(Date|Date32|DateTime(?:\(.*\))?|DateTime64\(.*\))$/,
      number: /^(U?Int\d+|Float\d+|Decimal\w*\(.*\))$/,
      string: /^(String|FixedString\([1-9]\d*\)|UUID)$/,
    }[cursorType].test(unwrapped);
  },
  supportsDeleteType(type) {
    const scalar = unwrapLowCardinality(type).replace(/^Nullable\((.*)\)$/, "$1");
    // Enum labels may be '0'/'1'; wider FixedString pads with NULs and cannot
    // represent those exact values. Nullable(Nothing) represents only null.
    return (
      /^(?:Bool|U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|Decimal(?:32|64|128|256)?\(\d+(?:,\s*\d+)?\)|String|FixedString\(1\)|Enum(?:8|16)\(.*\))$/s.test(
        scalar
      ) || type === "Nullable(Nothing)"
    );
  },
  validateCheckpointType: checkpointType,
  createParameters() {
    const queryParams: Record<string, string> = {};
    return {
      values: [],
      queryParams,
      bind(value, type, index) {
        const parameterType = checkpointType(type);
        queryParams["p" + index] = value;
        return "{p" + index + ": " + parameterType + "}";
      },
    };
  },
  lookbackPredicate: (column, parameter, seconds) => column + " >= subtractSeconds(" + parameter + ", " + seconds + ")",
});

export function createClickHouseReader(input: Record<string, any>): WarehouseReader {
  const config = chCredentials.parse(input);
  const host = config.hosts[0];
  // Match the destination's host[:port] contract; reject URL params/userinfo that
  // could override readonly settings or credentials in the ClickHouse client.
  const url = new URL(`${config.protocol}://${host}`);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Expected a ClickHouse host[:port]");
  // URL normalizes explicit :443/:80 to an empty port; those proxies must not
  // silently move to ClickHouse's native HTTP(S) defaults.
  if (!url.port && !/:\d+\/?$/.test(host.trim())) url.port = config.protocol === "https" ? "8443" : "8123";
  const client = createClient({
    url: url.toString(),
    username: config.username,
    password: config.password,
    database: config.database,
    request_timeout: 30_000,
    max_open_connections: 2,
    clickhouse_settings: {
      readonly: "1",
      max_execution_time: 30,
      max_memory_usage: "268435456",
      output_format_json_quote_64bit_integers: 1,
      output_format_json_quote_decimals: 1,
    },
  });
  async function columns(query: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const result = await client.query({
      query: `SELECT * FROM (${query}\n) AS model LIMIT 0`,
      format: "JSON",
      abort_signal: signal,
    });
    try {
      const meta = (await result.json()).meta;
      if (!meta) throw new Error("Warehouse did not return column metadata");
      return meta;
    } finally {
      result.close();
    }
  }
  return {
    sql: clickhouseSql,
    columns(query, signal) {
      return columns(clickhouseSql.validateQuery(query), signal);
    },
    async preview(query, signal) {
      const sql = clickhouseSql.validateQuery(query);
      const cols = await columns(sql, signal);
      signal?.throwIfAborted();
      const result = await client.query({
        query: `SELECT * FROM (${sql}\n) AS model LIMIT 101`,
        format: "JSONEachRow",
        abort_signal: signal,
        clickhouse_settings: { max_result_bytes: "2000000", result_overflow_mode: "throw" },
      });
      try {
        const rows: Record<string, unknown>[] = [];
        for await (const chunk of result.stream<Record<string, unknown>>()) {
          for (const item of chunk) {
            rows.push(item.json());
            boundedPreview(cols, rows);
          }
        }
        return boundedPreview(cols, rows);
      } finally {
        result.close();
      }
    },
    async *stream(input, after, signal) {
      const model = ModelDefinition.parse(input);
      const sql = clickhouseSql.validateQuery(model.query);
      const cols = await columns(sql, signal);
      const compiled = clickhouseSql.compileModel(model, cols, after);
      signal?.throwIfAborted();
      const result = await client.query({
        query: compiled.query,
        query_params: compiled.queryParams,
        format: "JSONEachRow",
        abort_signal: signal,
        clickhouse_settings: { max_block_size: String(model.pageSize) },
      });
      try {
        for await (const chunk of result.stream<Record<string, unknown>>()) {
          for (const item of chunk) {
            signal?.throwIfAborted();
            yield decodeRecord(model, item.json());
          }
        }
      } finally {
        result.close();
      }
    },
    close() {
      return client.close();
    },
  };
}
