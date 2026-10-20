import { rejectionDetailsMessage, safeRejectionDetails } from "../../../reverse-etl/rejection-details";

/** Safe diagnostics only: never retain Google's free-text message, URLs or request data. */
export class GoogleRequestError extends Error {
  readonly details: ReturnType<typeof safeRejectionDetails>;
  constructor(
    readonly httpStatus: number,
    readonly providerCode: string | undefined,
    readonly operation: "conversion upload" | "status lookup" | "custom-variable lookup" | "audience management",
    readonly definitiveRejection: boolean,
    details?: unknown
  ) {
    super(
      `Google ${operation} returned HTTP ${httpStatus}${
        providerCode ? ` (${providerCode})` : ""
      }${rejectionDetailsMessage(details)}`
    );
    this.details = safeRejectionDetails(details);
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

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** https://developers.google.com/data-manager/api/devguides/concepts/understand-errors */
function googleErrorDetails(value: unknown) {
  const fields: unknown[] = [];
  const reasons: unknown[] = [];
  for (const raw of Array.isArray(value) ? value.slice(0, 20) : []) {
    const detail = object(raw);
    if (detail["@type"] === "type.googleapis.com/google.rpc.BadRequest") {
      for (const rawField of Array.isArray(detail.fieldViolations) ? detail.fieldViolations.slice(0, 100) : []) {
        const violation = object(rawField);
        if (typeof violation.field !== "string") continue;
        fields.push({ field: violation.field, reason: violation.reason ?? "INVALID_ARGUMENT" });
      }
    } else if (detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo") {
      reasons.push({ reason: detail.reason });
    } else if (
      typeof detail["@type"] === "string" &&
      /^type\.googleapis\.com\/google\.ads\.googleads\.v\d+\.errors\.GoogleAdsFailure$/.test(detail["@type"])
    ) {
      for (const rawError of Array.isArray(detail.errors) ? detail.errors.slice(0, 100) : []) {
        const error = object(rawError);
        const elements = object(error.location).fieldPathElements;
        const field = Array.isArray(elements)
          ? elements
              .slice(0, 20)
              .map(rawElement => {
                const element = object(rawElement);
                if (
                  typeof element.fieldName !== "string" ||
                  (element.index !== undefined &&
                    (typeof element.index !== "number" || !Number.isSafeInteger(element.index) || element.index < 0))
                )
                  return "";
                return `${element.fieldName}${element.index === undefined ? "" : `[${element.index}]`}`;
              })
              .join(".")
          : undefined;
        fields.push({ field, reason: Object.values(object(error.errorCode))[0] });
      }
    }
  }
  // Field-specific errors are more useful than a repeated top-level INVALID_ARGUMENT.
  return safeRejectionDetails([...fields, ...reasons]);
}

export async function googleRequestError(
  response: { status: number; json(): Promise<unknown> },
  operation: GoogleRequestError["operation"]
) {
  const body = object(await response.json().catch(() => undefined));
  const error = object(body.error);
  const code = typeof error.status === "string" && statuses.has(error.status) ? error.status : undefined;
  // Only a structured API rejection is delivery evidence. A proxy error or lost response is not.
  return new GoogleRequestError(
    response.status,
    code,
    operation,
    !!code && response.status >= 400 && response.status < 500 && response.status !== 408,
    googleErrorDetails(error.details)
  );
}
