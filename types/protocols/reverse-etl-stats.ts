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
  replacement: z.enum(["not_started", "prepared", "pending", "accepted"]).optional(),
});
export type ReverseBatchCounts = z.infer<typeof ReverseBatchCounts>;
export type ReverseDeliveryStats = z.infer<typeof ReverseDeliveryStats>;
