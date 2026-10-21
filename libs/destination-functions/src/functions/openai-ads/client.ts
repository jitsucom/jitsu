import { z } from "zod";

/** Conversions API host: separate from the Ads API, with its own key (developers.openai.com/ads/conversions-api). */
export const openAiConversionsUrl = "https://bzr.openai.com/v1/events";
/** Identifies Jitsu to OpenAI as a partner integration; the value applies to every event in the batch. */
export const openAiIntegrationSource = "jitsu";

/** An observability failure must not discard a known provider receipt. */
export async function openAiLog(log: (message: string) => Promise<unknown>, message: string) {
  try {
    await log(message);
  } catch {
    /* Delivery journaling remains the mandatory durable boundary. */
  }
}
type Request = {
  method: "POST";
  headers: Record<string, string>;
  signal: AbortSignal;
  redirect: "error";
  body: string;
};
export type OpenAiFetch = (
  url: string,
  options: Request
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** The request may or may not have reached OpenAI: timeout, connection loss, redirect or an aborted call mid-flight. */
export class OpenAiTransportError extends Error {
  constructor() {
    super("OpenAI request did not return a verifiable response; do not replay an uncertain write");
  }
}

/** Never retain provider messages, request URLs or keys. Only the status and the short error enum survive. */
export class OpenAiApiError extends Error {
  constructor(readonly status: number, readonly code?: string, readonly param?: string) {
    super(`OpenAI API HTTP ${status}${code ? ` (${code})` : ""}`);
  }
  /** A definite refusal of the request. Everything else, including 429 and 5xx, leaves delivery unproven. */
  get rejected() {
    return [400, 401, 403, 404, 413, 422].includes(this.status) && this.hasEnvelope;
  }
  hasEnvelope = false;
}
const errorEnvelope = z.object({
  error: z.object({
    code: z.string().max(64).nullish(),
    param: z.string().max(256).nullish(),
  }),
});

/**
 * One attempt per batch. OpenAI documents retrying with the same event ID, but not how long it remembers an ID, so a
 * lost response stays a manual reconciliation like Meta's, never an automatic replay.
 */
export async function openAiSendEvents(
  fetch: OpenAiFetch,
  apiKey: string,
  pixelId: string,
  signal: AbortSignal,
  events: unknown[]
): Promise<void> {
  signal.throwIfAborted();
  const body = JSON.stringify({ integration_source: openAiIntegrationSource, events });
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error("OpenAI request exceeds Jitsu's 8 MiB batch limit");
  let response: Awaited<ReturnType<OpenAiFetch>>;
  try {
    response = await fetch(`${openAiConversionsUrl}?pid=${encodeURIComponent(pixelId)}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
    });
  } catch {
    throw new OpenAiTransportError();
  }
  if (response.ok) return;
  let parsed: ReturnType<typeof errorEnvelope.safeParse> | undefined;
  try {
    parsed = errorEnvelope.safeParse(await response.json());
  } catch {
    /* A non-JSON error body proves nothing about delivery. */
  }
  const error = new OpenAiApiError(
    response.status,
    parsed?.success ? parsed.data.error.code ?? undefined : undefined,
    parsed?.success ? parsed.data.error.param ?? undefined : undefined
  );
  error.hasEnvelope = !!parsed?.success;
  throw error;
}
