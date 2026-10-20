import { reverseEtlFailure } from "@jitsu/destination-functions/src/reverse-etl/failure";
import { ReverseEtlRejectionError } from "@jitsu/destination-functions/src/reverse-etl/meta";
import { GoogleRequestError } from "@jitsu/destination-functions/src/functions/google-ads/clients/errors";
import { rejectionDetailsMessage } from "@jitsu/destination-functions/src/reverse-etl/rejection-details";

export type FailureStage = "startup" | "lease_acquire" | "task_start" | "admission" | "execution";

const codes = new Set([
  "EACCES",
  "ENOENT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "28P01",
  "28000",
  "3D000",
  "3F000",
  "42P01",
  "42703",
  "42501",
  "23502",
  "23505",
  "57014",
  "53300",
]);
const reasons = new Set([
  "Kubernetes lease read failed",
  "Kubernetes lease acquisition failed",
  "Reverse sync already running",
  "Kubernetes request failed",
  "Kubernetes deadline exceeded",
  "Invalid Kubernetes response",
  "Reverse ETL database connection failed",
  "Reverse ETL persistence transaction failed",
  "Task already exists",
]);

/** Only fixed reasons and validated structured diagnostics reach stderr; never raw provider messages or payloads. */
export function failureDiagnostic(stage: FailureStage, error: unknown) {
  const diagnostic: { event: string; stage: FailureStage; reason?: string; code?: string; httpStatus?: number } = {
    event: "reverse_etl_failure",
    stage,
  };
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const item = current as { message?: unknown; code?: unknown; cause?: unknown };
    diagnostic.reason ??= reverseEtlFailure(current)?.reason;
    if (typeof item.message === "string" && reasons.has(item.message)) diagnostic.reason ??= item.message;
    if (typeof item.code === "string" && codes.has(item.code)) diagnostic.code ??= item.code;
    if (current instanceof KubernetesHttpError) diagnostic.httpStatus = current.status;
    if (current instanceof GoogleRequestError) {
      diagnostic.httpStatus = current.httpStatus;
      diagnostic.code = current.providerCode;
      diagnostic.reason = current.message;
    }
    current = item.cause;
  }
  return diagnostic;
}

export class KubernetesHttpError extends Error {
  constructor(readonly status: number) {
    super("Kubernetes API request rejected");
  }
}

export function reportFailure(stage: FailureStage, error: unknown) {
  process.stderr.write(`${JSON.stringify(failureDiagnostic(stage, error))}\n`);
}

/** Use the same redacted reason in task details and persisted task logs. */
export function failureMessage(error: unknown, taskId: string): string {
  let current = error;
  let google: GoogleRequestError | undefined;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++, current = current.cause)
    if (current instanceof GoogleRequestError) {
      google = current;
      break;
    }
  if (google)
    return `${google.message}. ${
      google.operation === "audience management"
        ? "Check the Google account ID, OAuth permissions and audience access. No audience members were uploaded by this attempt; preserve any saved audience creation request."
        : google.operation === "status lookup"
        ? "Status could not be checked; saved delivery remains unchanged. Try Refresh status again."
        : "Delivery could not be confirmed. Saved requests are retained; do not reset or replay this run."
    } Run ID: ${taskId}.`;
  const message =
    reverseEtlFailure(error)?.message ??
    "Reverse ETL could not complete. Contact support or your Jitsu administrator. Some changes may already have been submitted; do not reset sync state.";
  // Only structured enum codes and field paths are shown; provider free text never is.
  const code = error instanceof ReverseEtlRejectionError ? error.code : undefined;
  const details = error instanceof ReverseEtlRejectionError ? rejectionDetailsMessage(error.details) : "";
  return `${message}${code ? ` Reason code: ${code}.` : ""}${details} Run ID: ${taskId}.`;
}
