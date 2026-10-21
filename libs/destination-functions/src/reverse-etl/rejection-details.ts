import { z } from "zod";
import type { ReverseEtlRejectionDetail } from "@jitsu/protocols/reverse-etl";

// Structured API enum names and protobuf field paths only, never descriptions, values,
// quoted map keys, URLs or credentials. Keep diagnostics small enough for per-row receipts.
export const rejectionDetail = z
  .object({
    reason: z
      .string()
      .max(96)
      .regex(/^[A-Z]+(?:_[A-Z0-9]+)*$/),
    field: z
      .string()
      .max(128)
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*(?:\[\d{1,6}\])?(?:\.[a-zA-Z][a-zA-Z0-9_]*(?:\[\d{1,6}\])?)*$/)
      .optional(),
  })
  .strict();

export function safeRejectionDetails(value: unknown): ReverseEtlRejectionDetail[] {
  if (!Array.isArray(value)) return [];
  const result: ReverseEtlRejectionDetail[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, 100)) {
    const parsed = rejectionDetail.safeParse(item);
    if (!parsed.success) continue;
    const key = JSON.stringify(parsed.data);
    if (!seen.has(key)) {
      result.push(parsed.data as ReverseEtlRejectionDetail);
      seen.add(key);
    }
    if (result.length === 3) break;
  }
  return result;
}

export function rejectionDetailsMessage(value: unknown): string {
  const details = safeRejectionDetails(value);
  return details.length
    ? ` Destination details (up to 3): ${details
        .map(d => (d.field ? `${d.field}: ${d.reason}` : d.reason))
        .join("; ")}.`
    : "";
}
