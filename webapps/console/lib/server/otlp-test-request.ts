import { createGuardedFetch, isBlockedAddressError, parseLocalWhitelist } from "@jitsu/core-functions-lib";
import { getServerEnv } from "./serverEnv";

const responsePreviewLimit = 1000;

export type OtlpTestResult = { ok: boolean; status?: number; response?: string; error?: string };

// The endpoint is typed in by a workspace member and the answer goes back to them, so the server must not be a way to
// reach internal addresses (cloud metadata, cluster services): the connection is refused when the address it would
// really use is not public, on every redirect hop. A self-hosted install that tests an internal collector lists its
// host in FETCH_LOCAL_WHITELIST.
let defaultFetch: ReturnType<typeof createGuardedFetch> | undefined;
function guardedFetch() {
  return (defaultFetch ??= createGuardedFetch({
    allowedHosts: parseLocalWhitelist(getServerEnv().FETCH_LOCAL_WHITELIST),
  }));
}

// reads at most `limit` characters of the body and cancels the rest — the
// preview cap must also be a memory cap, not a post-hoc truncation of a
// fully-buffered response from an arbitrary endpoint
async function readResponsePreview(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const decoder = new TextDecoder();
  let preview = "";
  try {
    while (preview.length < limit) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      preview += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return preview.slice(0, limit);
}

export async function sendOtlpTestRequest(
  settings: { endpoint: string; headers: { name: string; value: string }[] },
  payload: Uint8Array,
  opts: { fetch?: ReturnType<typeof createGuardedFetch>; onFailure?: (error: unknown) => void } = {}
): Promise<OtlpTestResult> {
  try {
    const response = await (opts.fetch ?? guardedFetch())(settings.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-protobuf",
        ...Object.fromEntries(settings.headers.map(h => [h.name, h.value])),
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await readResponsePreview(response as unknown as Response, responsePreviewLimit);
    return { ok: response.ok, status: response.status, response: text };
  } catch (e: any) {
    opts.onFailure?.(e);
    if (isBlockedAddressError(e)) {
      return {
        ok: false,
        error:
          "The endpoint is on a private or internal address, which is not allowed. " +
          "A self-hosted install can allow a host with FETCH_LOCAL_WHITELIST.",
      };
    }
    return { ok: false, error: e.message };
  }
}
