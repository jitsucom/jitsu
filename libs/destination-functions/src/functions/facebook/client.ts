import { z } from "zod";

export const metaGraphUrl = "https://graph.facebook.com/v26.0/";
/** An observability failure must not discard a known provider receipt. */
export async function metaLog(log: (message: string) => Promise<unknown>, message: string) {
  try {
    await log(message);
  } catch {
    /* Delivery journaling remains the mandatory durable boundary. */
  }
}
type Request = {
  method: "GET" | "POST" | "DELETE";
  headers: Record<string, string>;
  signal: AbortSignal;
  redirect: "error";
  body?: string;
};
export type MetaFetch = (
  url: string,
  options: Request
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Never retain provider messages, request URLs with tokens, or invalid-entry samples. */
export class MetaApiError extends Error {
  constructor(readonly status: number, readonly code?: number, readonly subcode?: number, readonly transient = false) {
    super(
      `Meta API HTTP ${status}${
        code === undefined ? "" : ` (code ${code}${subcode === undefined ? "" : `/${subcode}`})`
      }`
    );
  }
  get rejected() {
    return [400, 401, 403, 404, 422].includes(this.status) && this.code !== undefined && !this.transient;
  }
}
const graphError = z.object({
  error: z.object({
    code: z.number().int().nonnegative(),
    error_subcode: z.number().int().nonnegative().optional(),
    is_transient: z.boolean().optional(),
  }),
});

/** Writes are deliberately attempted once. Even timeout/429 is not proof of non-delivery. */
export async function metaRequest(
  fetch: MetaFetch,
  token: string,
  signal: AbortSignal,
  path: string,
  method: Request["method"] = "GET",
  body?: unknown
): Promise<unknown> {
  signal.throwIfAborted();
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  if (serialized && Buffer.byteLength(serialized) > 8 * 1024 * 1024)
    throw new Error("Meta request exceeds Jitsu's 8 MiB batch limit");
  // All paths are built locally from validated IDs and encoded query values.
  try {
    const response = await fetch(metaGraphUrl + path, {
      method,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(serialized === undefined ? {} : { body: serialized }),
    });
    const value = await response.json();
    const error = graphError.safeParse(value);
    if (!response.ok || error.success)
      throw new MetaApiError(
        response.status,
        error.success ? error.data.error.code : undefined,
        error.success ? error.data.error.error_subcode : undefined,
        error.success && !!error.data.error.is_transient
      );
    return value;
  } catch (error) {
    if (error instanceof MetaApiError) throw error;
    throw new Error("Meta request did not return a verifiable response; do not replay an uncertain write");
  }
}
