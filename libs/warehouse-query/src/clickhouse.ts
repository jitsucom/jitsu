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

function endpoint(protocol: string, host: string): string {
  // Match the destination's host[:port] contract; reject URL params/userinfo that
  // could override readonly settings or credentials in the ClickHouse client.
  const url = new URL(`${protocol}://${host}`);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Expected a ClickHouse host[:port]");
  // URL normalizes explicit :443/:80 to an empty port; those proxies must not
  // silently move to ClickHouse's native HTTP(S) defaults.
  if (!url.port && !/:\d+\/?$/.test(host.trim())) url.port = protocol === "https" ? "8443" : "8123";
  return url.toString();
}

class HostProbeTimeout extends Error {}

function releaseOnAbort(result: { close(): void }, signal: AbortSignal): () => void {
  // The client detaches its abort listener once response headers arrive. Keep
  // cancellation connected while consuming the body, including the header race.
  const abort = () => result.close();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return () => {
    signal.removeEventListener("abort", abort);
    result.close();
  };
}

function canFailOver(error: unknown): boolean {
  // Only transport failures, never database/HTTP errors, invalid rows, or TLS
  // validation failures. ClickHouse server error codes are numeric strings.
  return (
    error instanceof HostProbeTimeout ||
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
      "EPIPE",
      "ERR_STREAM_PREMATURE_CLOSE",
    ].includes((error as NodeJS.ErrnoException)?.code ?? "")
  );
}

export function createClickHouseReader(input: Record<string, any>): WarehouseReader {
  const config = chCredentials.parse(input);
  // Validate every endpoint before making any request. Duplicate hosts do not
  // get extra attempts, and clients are allocated only for hosts actually used.
  const urls = [...new Set(config.hosts.map(host => endpoint(config.protocol, host)))];
  type Client = ReturnType<typeof createClient>;
  const clients = new Map<string, Client>();
  const closed = new AbortController();
  function getClient(url: string): Client {
    let client = clients.get(url);
    if (client) return client;
    client = createClient({
      url,
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
    clients.set(url, client);
    return client;
  }

  async function* withFailover<T>(
    read: (client: Client, signal: AbortSignal) => AsyncIterable<T>,
    externalSignal?: AbortSignal
  ): AsyncGenerator<T> {
    const signal = AbortSignal.any([closed.signal, ...(externalSignal ? [externalSignal] : [])]);
    for (const url of urls) {
      signal.throwIfAborted();
      let emitted = false;
      try {
        for await (const value of read(getClient(url), signal)) {
          signal.throwIfAborted();
          emitted = true;
          yield value;
        }
        signal.throwIfAborted();
        return;
      } catch (error) {
        signal.throwIfAborted();
        // Never mix replicas or replay an already-delivered prefix. Recovery
        // must resume a failed stream using its durably acknowledged checkpoint.
        if (emitted || !canFailOver(error) || url === urls[urls.length - 1]) throw error;
      }
    }
  }

  async function withFailoverResult<T>(
    read: (client: Client, signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    for await (const result of withFailover(async function* (client, signal) {
      yield await read(client, signal);
    }, signal))
      return result;
    throw new Error("No ClickHouse endpoint available");
  }

  async function columns(client: Client, query: string, signal: AbortSignal) {
    signal.throwIfAborted();
    // Metadata probes must not spend the entire console request deadline on a
    // dead first host. Actual data queries retain their existing 30s timeout.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), urls.length > 1 ? Math.min(5_000, 30_000 / urls.length) : 30_000);
    const probeSignal = AbortSignal.any([signal, timeout.signal]);
    try {
      const result = await client.query({
        query: `SELECT * FROM (${query}\n) AS model LIMIT 0`,
        format: "JSON",
        abort_signal: probeSignal,
      });
      const release = releaseOnAbort(result, probeSignal);
      try {
        probeSignal.throwIfAborted();
        const meta = (await result.json()).meta;
        probeSignal.throwIfAborted();
        if (!meta) throw new Error("Warehouse did not return column metadata");
        return meta;
      } finally {
        release();
      }
    } catch (error) {
      signal.throwIfAborted();
      if (timeout.signal.aborted) throw new HostProbeTimeout("ClickHouse metadata probe timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    sql: clickhouseSql,
    columns(query, signal) {
      const sql = clickhouseSql.validateQuery(query);
      return withFailoverResult((client, signal) => columns(client, sql, signal), signal);
    },
    async preview(query, signal) {
      const sql = clickhouseSql.validateQuery(query);
      return withFailoverResult(async (client, signal) => {
        const cols = await columns(client, sql, signal);
        signal.throwIfAborted();
        const result = await client.query({
          query: `SELECT * FROM (${sql}\n) AS model LIMIT 101`,
          format: "JSONEachRow",
          abort_signal: signal,
          clickhouse_settings: { max_result_bytes: "2000000", result_overflow_mode: "throw" },
        });
        const release = releaseOnAbort(result, signal);
        try {
          signal.throwIfAborted();
          const rows: Record<string, unknown>[] = [];
          for await (const chunk of result.stream<Record<string, unknown>>()) {
            for (const item of chunk) {
              rows.push(item.json());
              boundedPreview(cols, rows);
            }
          }
          return boundedPreview(cols, rows);
        } finally {
          release();
        }
      }, signal);
    },
    async *stream(input, after, signal) {
      const model = ModelDefinition.parse(input);
      const sql = clickhouseSql.validateQuery(model.query);
      yield* withFailover(async function* (client, signal) {
        const cols = await columns(client, sql, signal);
        const compiled = clickhouseSql.compileModel(model, cols, after);
        signal?.throwIfAborted();
        const result = await client.query({
          query: compiled.query,
          query_params: compiled.queryParams,
          format: "JSONEachRow",
          abort_signal: signal,
          clickhouse_settings: { max_block_size: String(model.pageSize) },
        });
        const release = releaseOnAbort(result, signal);
        try {
          signal.throwIfAborted();
          for await (const chunk of result.stream<Record<string, unknown>>()) {
            for (const item of chunk) {
              signal?.throwIfAborted();
              yield decodeRecord(model, item.json());
            }
          }
        } finally {
          release();
        }
      }, signal);
    },
    async close() {
      closed.abort(new Error("Reader is closed"));
      await Promise.all([...clients.values()].map(client => client.close()));
      clients.clear();
    },
  };
}
