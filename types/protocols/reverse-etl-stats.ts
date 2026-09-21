import { z } from "zod";

export const reverseBatchStatuses = [
  "prepared",
  "unconfirmed",
  "pending",
  "accepted",
  "rejected",
  "partial",
  "cancelled",
] as const;
const count = z.number().int().nonnegative();
export const reverseRecordStatuses = [
  "prepared",
  "unconfirmed",
  "pending",
  "rejected",
  "cancelled",
  "accepted",
] as const;
export const ReverseRecordCounts = z.object({
  total: count,
  prepared: count,
  unconfirmed: count,
  pending: count,
  accepted: count,
  rejected: count,
  cancelled: count,
});
export const ReverseBatchCounts = z.object({
  total: count,
  prepared: count,
  unconfirmed: count,
  pending: count,
  accepted: count,
  rejected: count,
  partial: count,
  cancelled: count,
});
/** Aggregate observability only, never used to authorize delivery or recovery. */
export const ReverseDeliveryStats = z.object({
  version: z.literal(1),
  runId: z.string(),
  observedAt: z.string().datetime(),
  upsert: ReverseBatchCounts,
  remove: ReverseBatchCounts,
  records: z.object({ accepted: count, pending: count, rejected: count }),
  /** Optional for older attempts that only retained batch counts per operation. */
  recordCounts: z.object({ upsert: ReverseRecordCounts, remove: ReverseRecordCounts }).optional(),
  replacement: z.enum(["not_started", "prepared", "pending", "accepted"]).optional(),
});
export type ReverseBatchCounts = z.infer<typeof ReverseBatchCounts>;
export type ReverseRecordCounts = z.infer<typeof ReverseRecordCounts>;
export type ReverseDeliveryStats = z.infer<typeof ReverseDeliveryStats>;
