import type { JsonObject, RecordOutcome } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "../../reverse-etl/identity";
import { GuardedRequestError, guardedRequest, type GuardedRequest, type GuardedResponse } from "../lib/guarded-request";
import { parseWebhookHeaders, type WebhookCredentials, type WebhookRowsOptions } from "./reverse-meta";
import { signatureHeaders } from "./signing";

export type Sender = (request: GuardedRequest) => Promise<GuardedResponse>;

export interface DeliveryDeps {
  send: Sender;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => Date;
  /** One diagnostic line per failed attempt, for the runner's own log. Codes only: no URL, header or body. */
  log?: (line: string) => void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new GuardedRequestError("aborted", false));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new GuardedRequestError("aborted", false));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export const defaultDeliveryDeps: DeliveryDeps = {
  send: guardedRequest,
  sleep,
  now: () => new Date(),
  log: line => process.stderr.write(`${line}\n`),
};

/** Waits before attempts 2, 3 and 4; a Retry-After longer than this is capped. */
export const retryDelaysMs = [1000, 2000, 4000];
export const maxRetryAfterMs = 30_000;

/** A request body never exceeds this; records are packed into requests by size as well as by count. */
export const maxRequestBytes = 1024 * 1024;
// Room for syncId, runId, sentAt and the surrounding JSON, which are not part of any record.
const envelopeOverheadBytes = 1024;

interface WireRecord {
  operation: DeliveryAction;
  key: string;
  idempotencyKey: string;
  data: JsonObject;
}
interface PreparedRecord {
  operationId: string;
  wire: WireRecord;
  bytes: number;
}

export type DeliveryAction = "upsert" | "delete";

export interface DeliveryRecord {
  operationId: string;
  key: string;
  row: JsonObject;
}

type AttemptResult =
  | { kind: "accepted" }
  | { kind: "rejected"; code: string; reason: string }
  | { kind: "retry"; code: string; reason: string; retryAfterMs?: number; detail?: string };

function parseRetryAfter(value: string | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxRetryAfterMs);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(Math.max(date - now.getTime(), 0), maxRetryAfterMs);
  return undefined;
}

function classifyStatus(response: GuardedResponse, now: Date): AttemptResult {
  const { status } = response;
  if (status >= 200 && status < 300) return { kind: "accepted" };
  if (status >= 300 && status < 400) {
    return { kind: "rejected", code: "redirect_refused", reason: `HTTP ${status} (redirects are not followed)` };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return {
      kind: "retry",
      code: `http_${status}`,
      reason: `HTTP ${status}`,
      retryAfterMs: parseRetryAfter(response.retryAfter, now),
    };
  }
  return { kind: "rejected", code: `http_${status}`, reason: `HTTP ${status}` };
}

const errorReasons: Record<string, string> = {
  blocked_address: "The endpoint's address is not allowed",
  invalid_url: "The webhook URL is not usable",
  tls_error: "The endpoint's certificate could not be verified",
  dns_error: "The endpoint's host name could not be resolved",
  connection_error: "The connection to the endpoint failed",
  timeout: "The endpoint did not respond in time",
};

function classifyError(error: unknown): AttemptResult {
  if (!(error instanceof GuardedRequestError)) {
    return { kind: "rejected", code: "internal_error", reason: "Unexpected delivery error" };
  }
  if (error.code === "dns_error" || error.code === "connection_error" || error.code === "timeout") {
    // After a connection existed the request may have been processed: report it as unconfirmed, not as a failure.
    const code = error.maybeDelivered ? "unconfirmed" : error.code;
    const reason = error.maybeDelivered ? "The endpoint did not confirm receipt" : errorReasons[error.code];
    return { kind: "retry", code, reason, detail: error.detail };
  }
  return { kind: "rejected", code: error.code, reason: errorReasons[error.code] ?? "Delivery failed" };
}

/** Runs `task` over `items` with at most `limit` in flight; results keep the input order. */
async function runPool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface DeliveryScope {
  syncId: string;
  runId: string;
}

export interface DeliveryArgs {
  records: DeliveryRecord[];
  action: DeliveryAction;
  scope: DeliveryScope;
  config: WebhookCredentials;
  options: WebhookRowsOptions;
  signal: AbortSignal;
  deps?: DeliveryDeps;
}

/** The same row content under the same sync, key and operation always gets the same idempotency key, across runs. */
export function idempotencyKey(syncId: string, key: string, action: DeliveryAction, row: JsonObject): string {
  return contentHash([syncId, key, action, contentHash(row)]);
}

const rejectAll = (chunk: PreparedRecord[], code: string, safeReason: string): RecordOutcome[] =>
  chunk.map(record => ({ operationId: record.operationId, status: "rejected" as const, code, safeReason }));

async function sendChunk(
  chunk: PreparedRecord[],
  args: DeliveryArgs,
  headers: Array<{ name: string; value: string }>
): Promise<RecordOutcome[]> {
  const deps = args.deps ?? defaultDeliveryDeps;
  const { scope, config, signal } = args;
  const records = chunk.map(record => record.wire);
  const signing = {
    method: config.signatureMethod,
    secret: config.signatureSecret,
    privateKey: config.signaturePrivateKey,
    header: config.signatureHeader,
    includeTimestamp: config.signatureIncludeTimestamp,
  };

  let last: AttemptResult = { kind: "rejected", code: "internal_error", reason: "Unexpected delivery error" };
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    const body = JSON.stringify({
      syncId: scope.syncId,
      runId: scope.runId,
      sentAt: deps.now().toISOString(),
      records,
    });
    if (Buffer.byteLength(body) > maxRequestBytes) {
      return rejectAll(chunk, "request_too_large", "A single record is larger than the request size limit (1 MiB)");
    }
    const request: GuardedRequest = {
      url: config.url,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Jitsu-ReverseETL/1",
        ...Object.fromEntries(headers.map(header => [header.name, header.value])),
        ...(records.length === 1 ? { "idempotency-key": records[0].idempotencyKey } : {}),
        ...signatureHeaders(body, signing),
      },
      body,
      signal,
    };
    try {
      last = classifyStatus(await deps.send(request), deps.now());
    } catch (error) {
      if (signal.aborted || (error instanceof GuardedRequestError && error.code === "aborted")) throw error;
      last = classifyError(error);
      if (error instanceof GuardedRequestError) {
        deps.log?.(
          `reverse-etl webhook attempt failed: code=${error.code} detail=${error.detail ?? "none"} ` +
            `delivered=${error.maybeDelivered} attempt=${attempt + 1}/${retryDelaysMs.length + 1}`
        );
      }
    }
    if (last.kind !== "retry" || attempt === retryDelaysMs.length) break;
    await deps.sleep(Math.max(retryDelaysMs[attempt], last.retryAfterMs ?? 0), signal);
  }

  return last.kind === "accepted"
    ? chunk.map(record => ({ operationId: record.operationId, status: "accepted" as const }))
    : rejectAll(chunk, last.code, last.reason);
}

/** One outcome per record. Never throws for a failure it can classify; only an abort propagates. */
export async function deliverBatch(args: DeliveryArgs): Promise<RecordOutcome[]> {
  const headers = parseWebhookHeaders(args.config.headers);
  const { scope, action } = args;
  const prepared: PreparedRecord[] = args.records.map(record => {
    const wire: WireRecord = {
      operation: action,
      key: record.key,
      idempotencyKey: idempotencyKey(scope.syncId, record.key, action, record.row),
      data: record.row,
    };
    return { operationId: record.operationId, wire, bytes: Buffer.byteLength(JSON.stringify(wire)) + 1 };
  });
  // Greedy packing: up to recordsPerRequest records and maxRequestBytes per request. A record that cannot fit alone
  // goes out as its own request and is rejected as too large, so it is reported and the run stops, never dropped.
  const chunks: PreparedRecord[][] = [];
  let current: PreparedRecord[] = [];
  let size = envelopeOverheadBytes;
  for (const record of prepared) {
    const full = current.length >= args.options.recordsPerRequest || size + record.bytes > maxRequestBytes;
    if (current.length && full) {
      chunks.push(current);
      current = [];
      size = envelopeOverheadBytes;
    }
    current.push(record);
    size += record.bytes;
  }
  if (current.length) chunks.push(current);
  const results = await runPool(chunks, args.options.concurrency, chunk => sendChunk(chunk, args, headers));
  return results.flat();
}
