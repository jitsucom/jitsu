import { z } from "zod";
import { MetaId } from "./reverse-meta";

export const MetaMetricUnavailable = z.object({
  status: z.literal("unavailable"),
  reason: z.enum([
    "not-reported",
    "privacy-limited",
    "processing",
    "not-eligible",
    "no-snapshot",
    "empty-snapshot",
    "invalid-response",
  ]),
});
const number = z.number().finite().nonnegative();
export const MetaScalarMetric = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), value: number }),
  MetaMetricUnavailable,
]);
export const MetaRangeMetric = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), lower: number, upper: number }),
  MetaMetricUnavailable,
]);
const observedAt = z.string().datetime();
export const MetaResultsUnavailableReason = z.enum([
  "no-target",
  "state-mismatch",
  "credentials",
  "permissions",
  "target-access",
  "temporarily-unavailable",
  "invalid-response",
  "unsupported",
]);
export const MetaDestinationResults = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("unavailable"),
    observedAt,
    reason: MetaResultsUnavailableReason,
    message: z.string(),
  }),
  z.object({
    kind: z.literal("audience"),
    observedAt,
    targetId: MetaId,
    size: MetaRangeMetric,
    matchRate: MetaRangeMetric,
    denominatorRows: z.number().int().positive().optional(),
    operationCode: z.number().int().nonnegative().optional(),
    deliveryCode: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("conversions"),
    observedAt,
    targetId: MetaId,
    events: z
      .array(z.object({ eventName: z.string().max(256), emq: MetaScalarMetric, acr: MetaScalarMetric }))
      .max(1000),
  }),
]);
export type MetaDestinationResults = z.infer<typeof MetaDestinationResults>;
export type MetaRangeMetric = z.infer<typeof MetaRangeMetric>;
export type MetaScalarMetric = z.infer<typeof MetaScalarMetric>;
