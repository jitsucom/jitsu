type FailureCode =
  | "http"
  | "network"
  | "timeout"
  | "cancelled"
  | "invalid_json"
  | "invalid_response"
  | "invalid_choices"
  | "invalid_probabilities"
  | "internal";

export class MappingProviderFailure extends Error {
  constructor(readonly code: FailureCode, readonly status?: number, readonly retryAfterMs?: number) {
    // Only controlled codes, never a provider response or original exception message.
    super(code);
  }
}

const transientStatuses = new Set([408, 429, 500, 502, 503, 504, 529]);
const transientNetworkCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export function classifyMappingFailure(error: unknown, signal: AbortSignal): MappingProviderFailure {
  if (signal.aborted)
    return new MappingProviderFailure(signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled");
  if (error instanceof MappingProviderFailure) return error;
  const cause = error as { cause?: { code?: string }; code?: string } | null;
  const code = cause?.cause?.code ?? cause?.code;
  if (
    (code && transientNetworkCodes.has(code)) ||
    (!code && error instanceof TypeError && error.message === "fetch failed")
  )
    return new MappingProviderFailure("network");
  return new MappingProviderFailure("internal");
}

function retryAfter(headers: Headers): number | undefined {
  const milliseconds = headers.get("retry-after-ms");
  const seconds = headers.get("retry-after");
  const delay =
    milliseconds && /^\d+(\.\d+)?$/.test(milliseconds)
      ? Number(milliseconds)
      : seconds && /^\d+(\.\d+)?$/.test(seconds)
      ? Number(seconds) * 1000
      : seconds
      ? Date.parse(seconds) - Date.now()
      : NaN;
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export type MappingAttemptLog = {
  attempt: number;
  elapsedMs: number;
  outcome: "success" | "retry" | "failed";
  category?: FailureCode;
  httpStatus?: number;
  retryDelayMs?: number;
};

/** Retry only this failed batch, never replay already-completed batches or expose response/error text. */
export async function requestMappingBatch<T>({
  body,
  apiKey,
  signal,
  deadline,
  parse,
  record,
  request,
}: {
  body: string;
  apiKey: string;
  signal: AbortSignal;
  deadline: number;
  parse: (value: unknown) => T;
  record: (event: MappingAttemptLog) => void;
  request: typeof fetch;
}): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), 8_000);
    const combined = AbortSignal.any([signal, controller.signal]);
    const started = Date.now();
    let status: number | undefined;
    let delay: number | undefined;
    try {
      const response = await request("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: combined,
        redirect: "error",
      });
      status = response.status;
      if (!response.ok) {
        const after = retryAfter(response.headers);
        await response.body?.cancel().catch(() => {});
        throw new MappingProviderFailure("http", status, after);
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch (error) {
        if (error instanceof SyntaxError) throw new MappingProviderFailure("invalid_json");
        throw error;
      }
      combined.throwIfAborted();
      const result = parse(json);
      record({ attempt, elapsedMs: Date.now() - started, outcome: "success", httpStatus: status });
      return result;
    } catch (error) {
      const failure = classifyMappingFailure(error, combined);
      const retryable =
        failure.code === "network" ||
        failure.code === "timeout" ||
        (failure.code === "http" && transientStatuses.has(failure.status!));
      const backoff = 500 * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.25);
      const nextDelay = Math.ceil(Math.max(backoff, failure.retryAfterMs ?? 0));
      const retry = retryable && attempt < 3 && !signal.aborted && nextDelay < deadline - Date.now();
      record({
        attempt,
        elapsedMs: Date.now() - started,
        outcome: retry ? "retry" : "failed",
        category: failure.code,
        httpStatus: status,
        ...(retry ? { retryDelayMs: nextDelay } : {}),
      });
      if (!retry) throw failure;
      delay = nextDelay;
    } finally {
      clearTimeout(timer);
    }
    await waitForRetry(delay!, signal);
  }
  throw new MappingProviderFailure("internal");
}
