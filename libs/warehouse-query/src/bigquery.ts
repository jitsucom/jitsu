import { randomUUID } from "node:crypto";
import { JWT } from "google-auth-library";
import { Parser } from "node-sql-parser";
import { z } from "zod";
import { ModelDefinition } from "./schema";
import { createSqlDialect } from "./sql";
import { boundedPreview, decodeRecord } from "./reader";
import { StreamDeadline } from "./stream-deadline";
import type { WarehouseReader } from "./types";

const credentials = z.object({
  project: z.string().min(1),
  bqDataset: z.string().min(1),
  keyFile: z.string().min(1),
  location: z.string().min(1).optional(),
  maximumBytesBilled: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});
const serviceAccount = z.object({
  type: z.literal("service_account"),
  client_email: z.string().email(),
  private_key: z.string().min(1),
});
const scalarType =
  /^(?:STRING|INTEGER|INT64|FLOAT|FLOAT64|NUMERIC|BIGNUMERIC|BOOLEAN|BOOL|DATE|TIME|DATETIME|TIMESTAMP)$/;
const parameterType = (type: string) => {
  if (!scalarType.test(type)) throw new Error(`Unsupported BigQuery checkpoint type: ${type}`);
  return ({ INTEGER: "INT64", FLOAT: "FLOAT64", BOOLEAN: "BOOL" } as Record<string, string>)[type] ?? type;
};
const parser = new Parser();
export const bigquerySql = createSqlDialect({
  parse: query => parser.astify(query, { database: "BigQuery" }),
  lineCommentPrefixes: ["--", "#"],
  backslashEscapes: () => true,
  quoteColumn: name => "`" + name.replaceAll("\\", "\\\\").replaceAll("`", "\\`") + "`",
  // Duplicate detection partitions by the key; GoogleSQL forbids FLOAT partitions.
  supportsPrimaryKeyType: type => scalarType.test(type) && !/^(FLOAT|FLOAT64)$/.test(type),
  supportsDeleteType: type => /^(?:STRING|INTEGER|INT64|FLOAT|FLOAT64|NUMERIC|BIGNUMERIC|BOOLEAN|BOOL)$/.test(type),
  supportsCursorType: (cursor, type) =>
    ({
      timestamp: /^(?:DATE|DATETIME|TIMESTAMP)$/,
      number: /^(?:INTEGER|INT64|FLOAT|FLOAT64|NUMERIC|BIGNUMERIC)$/,
      string: /^STRING$/,
    }[cursor].test(type)),
  validateCheckpointType: parameterType,
  createParameters() {
    const queryParams: Record<string, string> = {};
    return {
      values: [],
      queryParams,
      bind(value, type, index) {
        queryParams[`p${index}`] = value;
        return `CAST(@p${index} AS ${parameterType(type)})`;
      },
    };
  },
  lookbackPredicate: (column, parameter, seconds) =>
    `TIMESTAMP(${column}) >= TIMESTAMP_SUB(TIMESTAMP(${parameter}), INTERVAL ${seconds} SECOND)`,
});

interface Field {
  name: string;
  type: string;
  mode?: string;
  fields?: Field[];
}
interface Cell {
  v: unknown;
}
interface WireRow {
  f: Cell[];
}
interface QueryPage {
  jobComplete?: boolean;
  schema?: { fields?: Field[] };
  rows?: WireRow[];
  pageToken?: string;
  errors?: { message?: string }[];
}
function columnType(field: Field): string {
  return field.mode === "REPEATED" ? `ARRAY<${field.type}>` : field.type;
}
/** BigQuery wire integers/decimals and timestamp microseconds must never round-trip through Number. */
function decodeValue(field: Field, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (field.mode === "REPEATED")
    return (value as Cell[]).map(cell => decodeValue({ ...field, mode: undefined }, cell.v));
  if (field.type === "RECORD" || field.type === "STRUCT")
    return decodeBigQueryRow(field.fields ?? [], value as WireRow);
  if (field.type === "BOOLEAN" || field.type === "BOOL") return value === true || value === "true";
  if (field.type === "TIMESTAMP") {
    const micros = BigInt(String(value));
    const remainder = ((micros % 1_000_000n) + 1_000_000n) % 1_000_000n;
    const seconds = (micros - remainder) / 1_000_000n;
    return new Date(Number(seconds * 1000n))
      .toISOString()
      .replace(/\.\d{3}Z$/, `.${String(remainder).padStart(6, "0")}Z`);
  }
  if (field.type === "FLOAT" || field.type === "FLOAT64") {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }
  return value;
}
export function decodeBigQueryRow(fields: Field[], row: WireRow): Record<string, unknown> {
  if (row.f.length !== fields.length) throw new Error("BigQuery row does not match its schema");
  return Object.fromEntries(fields.map((field, index) => [field.name, decodeValue(field, row.f[index].v)]));
}

const api = "https://bigquery.googleapis.com/bigquery/v2";
const responseByteLimit = 24 * 1024 * 1024;
async function jsonResponse(response: Response): Promise<any> {
  if (!response.body) throw new Error("BigQuery returned an empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > responseByteLimit)
        throw new Error("BigQuery result page exceeds 24 MiB; select fewer or smaller columns");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!response.ok || body.error)
    throw new Error(body.error?.message ?? `BigQuery request failed (${response.status})`);
  return body;
}

export function createBigQueryReader(input: Record<string, any>): WarehouseReader {
  const config = credentials.parse(input);
  const key = serviceAccount.parse(JSON.parse(config.keyFile));
  // Construct only from validated key material. Never accept credential URLs,
  // external_account configs, impersonation, or ADC from the server environment.
  const auth = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/bigquery"],
    transporterOptions: { timeout: 30_000 },
  });
  const closed = new AbortController();
  const project = `${api}/projects/${encodeURIComponent(config.project)}`;
  const activeJobs = new Map<string, string>();
  let location: string | undefined = config.location;
  async function request(url: string, signal: AbortSignal, body?: unknown) {
    signal.throwIfAborted();
    const headers = await auth.getRequestHeaders(url);
    signal.throwIfAborted();
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      signal,
      redirect: "error",
      headers: { Authorization: headers.get("authorization")!, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return jsonResponse(response);
  }
  async function getLocation(deadline: StreamDeadline) {
    if (!location) {
      const dataset = await deadline.read(() =>
        request(`${project}/datasets/${encodeURIComponent(config.bqDataset)}`, deadline.signal)
      );
      if (typeof dataset.location !== "string" || !dataset.location)
        throw new Error("BigQuery dataset has no location");
      location = dataset.location;
    }
    return location!;
  }
  function queryConfig(query: string, queryParams: Record<string, string> = {}) {
    return {
      query,
      useLegacySql: false,
      defaultDataset: { projectId: config.project, datasetId: config.bqDataset },
      ...(config.maximumBytesBilled ? { maximumBytesBilled: config.maximumBytesBilled } : {}),
      ...(Object.keys(queryParams).length
        ? {
            parameterMode: "NAMED",
            queryParameters: Object.entries(queryParams).map(([name, value]) => ({
              name,
              parameterType: { type: "STRING" },
              parameterValue: { value },
            })),
          }
        : {}),
    };
  }
  async function inspect(query: string, deadline: StreamDeadline) {
    const region = await getLocation(deadline);
    const job = await deadline.read(() =>
      request(`${project}/jobs`, deadline.signal, {
        jobReference: { projectId: config.project, location: region },
        configuration: { dryRun: true, query: queryConfig(query) },
      })
    );
    const fields: Field[] | undefined = job.statistics?.query?.schema?.fields;
    if (!fields) throw new Error("BigQuery did not return column metadata");
    return fields;
  }
  async function cancel(id: string, region: string) {
    // Use an independent deadline: the extraction's signal may already be aborted.
    try {
      await request(
        `${project}/jobs/${encodeURIComponent(id)}/cancel?location=${encodeURIComponent(region)}`,
        AbortSignal.timeout(5000),
        {}
      );
    } catch {
      /* Server-side jobTimeoutMs remains a backstop when cancellation fails. */
    }
    activeJobs.delete(id);
  }
  async function* rows(
    query: string,
    queryParams: Record<string, string>,
    pageSize: number,
    deadline: StreamDeadline,
    timeoutMs: number
  ) {
    const region = await getLocation(deadline);
    const id = `jitsu_retl_${randomUUID().replaceAll("-", "")}`;
    activeJobs.set(id, region);
    let completed = false;
    try {
      const job = await deadline.read(() =>
        request(`${project}/jobs`, deadline.signal, {
          jobReference: { projectId: config.project, jobId: id, location: region },
          configuration: { jobTimeoutMs: String(timeoutMs), query: queryConfig(query, queryParams) },
        })
      );
      if (job.status?.errorResult) throw new Error(job.status.errorResult.message ?? "BigQuery query failed");
      let token: string | undefined;
      let fields: Field[] | undefined;
      do {
        const params = new URLSearchParams({
          location: region,
          maxResults: String(pageSize),
          timeoutMs: "10000",
          "formatOptions.useInt64Timestamp": "true",
        });
        if (token) params.set("pageToken", token);
        const page: QueryPage = await deadline.read(() =>
          request(`${project}/queries/${encodeURIComponent(id)}?${params}`, deadline.signal)
        );
        if (page.errors?.length) throw new Error(page.errors.map(error => error.message).join("; "));
        if (!page.jobComplete) continue;
        completed = true;
        fields ??= page.schema?.fields;
        if (!fields) throw new Error("BigQuery query returned no schema");
        for (const row of page.rows ?? []) {
          deadline.signal.throwIfAborted();
          yield decodeBigQueryRow(fields, row);
        }
        token = page.pageToken;
        if (!token) break;
      } while (true);
    } finally {
      if (!completed) await cancel(id, region);
      activeJobs.delete(id);
    }
  }
  function deadline(signal?: AbortSignal, timeoutMs = 30_000) {
    return new StreamDeadline(signal ? AbortSignal.any([signal, closed.signal]) : closed.signal, 30_000, timeoutMs);
  }
  return {
    sql: bigquerySql,
    async columns(query, signal) {
      const time = deadline(signal);
      try {
        return (await inspect(bigquerySql.validateQuery(query), time)).map(field => ({
          name: field.name,
          type: columnType(field),
        }));
      } finally {
        time.close();
      }
    },
    async preview(query, signal) {
      const time = deadline(signal);
      try {
        const sql = bigquerySql.validateQuery(query);
        const fields = await inspect(sql, time);
        const columns = fields.map(field => ({ name: field.name, type: columnType(field) }));
        const result: Record<string, unknown>[] = [];
        for await (const row of rows(`SELECT * FROM (${sql}\n) AS model LIMIT 101`, {}, 101, time, 30_000)) {
          result.push(row);
          boundedPreview(columns, result);
        }
        return boundedPreview(columns, result);
      } finally {
        time.close();
      }
    },
    async *stream(input, after, signal) {
      const time = deadline(signal, 2 * 60 * 60 * 1000);
      try {
        const model = ModelDefinition.parse(input);
        const columns = (await inspect(bigquerySql.validateQuery(model.query), time)).map(field => ({
          name: field.name,
          type: columnType(field),
        }));
        const compiled = bigquerySql.compileModel(model, columns, after);
        for await (const row of rows(compiled.query, compiled.queryParams, model.pageSize, time, 2 * 60 * 60 * 1000)) {
          const record = decodeRecord(model, row);
          // NaN never compares greater/equal in GoogleSQL; persisting it would
          // make the next incremental query silently exclude every source row.
          if (model.cursor?.type === "number" && !Number.isFinite(Number(record.checkpoint!.value)))
            throw new Error(
              "BigQuery numeric cursor must contain finite values; filter or cast non-finite values in the model query"
            );
          yield record;
        }
      } finally {
        time.close();
      }
    },
    async close() {
      closed.abort();
      await Promise.all([...activeJobs].map(([id, region]) => cancel(id, region)));
    },
  };
}
