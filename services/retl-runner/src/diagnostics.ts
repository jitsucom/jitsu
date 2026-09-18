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

/** Only allowlisted constants reach stderr: never error messages, stacks, URLs or provider payloads. */
export function failureDiagnostic(stage: FailureStage, error: unknown) {
  const diagnostic: { event: string; stage: FailureStage; reason?: string; code?: string; httpStatus?: number } = {
    event: "reverse_etl_failure",
    stage,
  };
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const item = current as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof item.message === "string" && reasons.has(item.message)) diagnostic.reason ??= item.message;
    if (typeof item.code === "string" && codes.has(item.code)) diagnostic.code ??= item.code;
    if (current instanceof KubernetesHttpError) diagnostic.httpStatus = current.status;
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
