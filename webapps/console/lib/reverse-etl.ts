import { z } from "zod";
import { ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";

export const ReverseSyncSetup = z
  .object({
    name: z.string().trim().min(1).max(200),
    modelId: z.string().min(1).max(128),
    destinationId: z.string().min(1).max(128),
    audience: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("managed"),
          displayName: z.string().trim().min(1).max(120),
          exclusiveManagementConfirmed: z.literal(true),
        })
        .strict(),
      z.object({ kind: z.literal("existing"), audienceId: z.string().regex(/^[1-9]\d{0,19}$/) }).strict(),
    ]),
    customerMatchTermsAccepted: z.literal(true),
    mapping: ReverseSyncOptions.shape.mapping,
    schedule: z.string().max(128).default(""),
    timezone: z
      .string()
      .trim()
      .max(128)
      .transform(value => value || "Etc/UTC")
      .default("Etc/UTC"),
  })
  .strict();
export type ReverseSyncSetup = z.infer<typeof ReverseSyncSetup>;
export const ReverseSyncSettings = ReverseSyncOptions.pick({
  name: true,
  schedule: true,
  timezone: true,
  disabled: true,
})
  .partial()
  .strict();
export const ReverseTask = z.object({
  task_id: z.string(),
  sync_id: z.string(),
  status: z.string(),
  started_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  description: z.string().nullable(),
  error: z.string().nullable(),
});
export type ReverseTask = z.infer<typeof ReverseTask>;
export const ReverseSyncView = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  modelName: z.string(),
  destinationName: z.string(),
  options: ReverseSyncOptions,
  setupPending: z.boolean(),
  audienceName: z.string().optional(),
  latestTask: ReverseTask.nullable(),
  phase: z.string().nullable(),
});
export type ReverseSyncView = z.infer<typeof ReverseSyncView>;

export const reverseStatusLabels: Record<string, string> = {
  RUNNING: "Running",
  WAITING: "Waiting for Google",
  RESUMED: "Continued in a later attempt",
  SUCCESS: "Succeeded",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  SKIPPED: "Skipped",
};
