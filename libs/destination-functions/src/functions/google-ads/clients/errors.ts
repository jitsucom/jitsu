/** Safe diagnostics only: never retain Google's free-text message, URLs or request data. */
export class GoogleRequestError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly providerCode: string | undefined,
    readonly operation: "conversion upload" | "status lookup" | "custom-variable lookup" | "audience management",
    readonly definitiveRejection: boolean
  ) {
    super(`Google ${operation} returned HTTP ${httpStatus}${providerCode ? ` (${providerCode})` : ""}`);
  }
}

const statuses = new Set([
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "RESOURCE_EXHAUSTED",
  "FAILED_PRECONDITION",
  "OUT_OF_RANGE",
  "UNIMPLEMENTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
  "CANCELLED",
  "UNKNOWN",
  "ABORTED",
  "DATA_LOSS",
]);

export async function googleRequestError(
  response: { status: number; json(): Promise<unknown> },
  operation: GoogleRequestError["operation"]
) {
  const body = (await response.json().catch(() => undefined)) as { error?: { status?: unknown } } | undefined;
  const code =
    typeof body?.error?.status === "string" && statuses.has(body.error.status)
      ? (body.error.status as string)
      : undefined;
  // Only a structured API rejection is delivery evidence. A proxy error or lost response is not.
  return new GoogleRequestError(
    response.status,
    code,
    operation,
    !!code && response.status >= 400 && response.status < 500 && response.status !== 408
  );
}
