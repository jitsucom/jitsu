import { z } from "zod";
import { ApiError } from "../shared/errors";

const uncertain = "Check attempts before retrying; the controller may already have received the request.";
// Only fixed controller messages are exposed. Never return arbitrary response bodies,
// fetch errors, URLs, or headers: these can contain credentials or upstream HTML.
const controllerMessages: Record<string, string> = {
  "Reverse runner is disabled": "Reverse ETL is disabled in syncctl. Ask your administrator to enable the runner.",
  "Reverse configuration is unavailable or stale":
    "Syncctl has not loaded this sync's current configuration. Check its console export connection and try again after it refreshes.",
  "Enable the sync before running it": "Enable the sync before running it.",
  "Failed to prepare reverse job":
    "Syncctl could not prepare the runner configuration. Check its Kubernetes permissions and availability.",
  "Reverse job creation rejected":
    "Kubernetes rejected the runner pod. Check syncctl logs, permissions and cluster quotas.",
  "Reverse job creation uncertain": `Syncctl could not confirm whether Kubernetes created the runner pod. ${uncertain}`,
  "Saved run is unavailable or a status check is already active":
    "The saved run is unavailable or a status check is already active. Refresh the runs list.",
  "Status refresh queued; automatic scheduling will retry":
    "The status refresh was queued but could not start yet. Syncctl will retry automatically.",
};

function networkReason(error: unknown): string {
  const pending: unknown[] = [error];
  for (let i = 0; i < pending.length && i < 12; i++) {
    const e = pending[i];
    if (!e || typeof e !== "object") continue;
    const { code, name, cause, errors } = e as { code?: string; name?: string; cause?: unknown; errors?: unknown[] };
    if (code === "ECONNREFUSED") return "Connection refused";
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Controller hostname could not be resolved";
    if (
      [
        "CERT_HAS_EXPIRED",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "ERR_TLS_CERT_ALTNAME_INVALID",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      ].includes(code ?? "")
    )
      return "Controller TLS certificate could not be verified";
    if (name === "TimeoutError" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT")
      return "Controller request timed out";
    if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "Connection to the controller was interrupted";
    pending.push(cause);
    if (Array.isArray(errors)) pending.push(...errors.slice(0, 8));
  }
  return "Could not communicate with the sync controller";
}

export async function requestReverseController(
  input: {
    baseUrl: string;
    token?: string;
    action: "run" | "refresh" | "cancel";
    query: Record<string, string>;
  },
  request: typeof fetch = fetch
): Promise<{ ok: true; taskId?: string }> {
  const url = new URL(`${input.baseUrl.replace(/\/$/, "")}/${input.action === "cancel" ? "cancel" : "read"}`);
  for (const [key, value] of Object.entries(input.query)) url.searchParams.set(key, value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  let response: Response;
  let body: unknown;
  try {
    response = await request(url.toString(), {
      method: input.action === "cancel" ? "GET" : "POST",
      headers: input.token ? { Authorization: `Bearer ${input.token}` } : {},
      redirect: "error",
      cache: "no-store",
      // Allow the controller's 30-second configuration wait to finish. Never retry
      // this request automatically: a lost response can hide a successfully started run.
      signal: AbortSignal.timeout(45_000),
    });
  } catch (error) {
    const hint = local
      ? " Check the local syncctl port-forward (helm/dev-deploy.sh tunnel) and SYNCCTL_URL; use 127.0.0.1 for an IPv4-only tunnel."
      : " Ask your administrator to check SYNCCTL_URL and connectivity to syncctl.";
    throw new ApiError(`${networkReason(error)}.${hint} ${uncertain}`, { status: 503 });
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new ApiError(
      "Sync controller authentication was rejected. Ask your administrator to check SYNCCTL_AUTH_KEY against syncctl's configured authentication tokens.",
      { status: 503 }
    );
  }
  try {
    body = await response.json();
  } catch {
    throw new ApiError(`Sync controller returned an unreadable response (HTTP ${response.status}). ${uncertain}`, {
      status: 503,
    });
  }
  const result = z
    .object({
      ok: z.literal(true),
      taskId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,128}$/)
        .optional(),
    })
    .safeParse(body);
  if (response.ok && result.success && (input.action === "cancel" || result.data.taskId)) return result.data;
  const error = z.object({ error: z.string() }).safeParse(body);
  const reason =
    error.success && Object.hasOwn(controllerMessages, error.data.error)
      ? controllerMessages[error.data.error]
      : undefined;
  throw new ApiError(
    reason ?? `Sync controller could not confirm the operation (HTTP ${response.status}). ${uncertain}`,
    {
      status: response.status === 409 ? 409 : 503,
    }
  );
}
