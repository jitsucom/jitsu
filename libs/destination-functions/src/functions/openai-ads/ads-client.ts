import { OpenAiApiError, OpenAiTransportError, readOpenAiApiError } from "./client";

/** Ads API host: separate from the Conversions API host, with its own key scoped to one ad account. */
export const openAiAdsUrl = "https://api.ads.openai.com/v1";

type Response = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers?: { get(name: string): string | null };
};
export type OpenAiAdsFetch = (
  url: string,
  options: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    signal: AbortSignal;
    redirect: "error";
    body?: string;
  }
) => Promise<Response>;

export type OpenAiAdsCall = {
  fetch: OpenAiAdsFetch;
  apiKey: string;
  /** The run's abort signal; every request and every wait stops with it. */
  signal: AbortSignal;
};

/** Seconds from a `Retry-After` header, capped, or undefined when absent or not a number of seconds. */
export function retryAfterSeconds(error: OpenAiApiError): number | undefined {
  return error.retryAfter === undefined ? undefined : Math.min(Math.max(error.retryAfter, 0), 120);
}

/**
 * One JSON request. A non-2xx answer is an `OpenAiApiError` (a definite refusal only when it carries OpenAI's error
 * envelope; Cloudflare's plain-text 403 "error code: 1010" is not one). A lost connection, a timeout, an unreadable
 * success body or a redirect is an `OpenAiTransportError`: the request may or may not have been applied.
 */
export async function openAiAdsRequest(
  call: OpenAiAdsCall,
  method: "GET" | "POST",
  path: string,
  options: { body?: unknown; idempotencyKey?: string; timeoutMs?: number } = {}
): Promise<unknown> {
  call.signal.throwIfAborted();
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  // The body limit is 16 MiB; stay well under it so a refusal is never because of our own size.
  if (body && Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error("OpenAI request exceeds Jitsu's 8 MiB limit");
  let response: Response;
  try {
    response = await call.fetch(`${openAiAdsUrl}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.any([call.signal, AbortSignal.timeout(options.timeoutMs ?? 60_000)]),
      headers: {
        Authorization: `Bearer ${call.apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      ...(body ? { body } : {}),
    });
  } catch {
    call.signal.throwIfAborted();
    throw new OpenAiTransportError();
  }
  if (!response.ok) {
    const error = await readOpenAiApiError(response);
    // Only a header that is really there: Number(null) is 0, which would read "no header" as "retry now".
    const header = response.headers?.get("retry-after");
    const retryAfter = header == null || header.trim() === "" ? NaN : Number(header);
    if (Number.isFinite(retryAfter) && retryAfter >= 0) error.retryAfter = retryAfter;
    throw error;
  }
  try {
    return await response.json();
  } catch {
    throw new OpenAiTransportError();
  }
}

/** Timing the audience code waits with. Tests replace it so nothing really sleeps. */
export type OpenAiWait = {
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
};
export const realWait: OpenAiWait = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }),
};
