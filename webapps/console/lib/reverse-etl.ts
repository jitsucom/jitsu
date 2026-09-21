import { z } from "zod";
import { ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";
import { ReverseDeliveryStats } from "@jitsu/protocols/reverse-etl-stats";

export const ReverseSyncInput = z
  .object({
    fromId: z.string().min(1).max(128),
    toId: z.string().min(1).max(128),
    data: ReverseSyncOptions,
  })
  .strict();
export type ReverseSyncInput = z.infer<typeof ReverseSyncInput>;
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
  trigger: z.enum(["manual", "scheduled", "recovery"]).nullable().default(null),
  stats: ReverseDeliveryStats.nullable().default(null),
});
export type ReverseTask = z.infer<typeof ReverseTask>;
export const ReverseSyncView = z.object({
  id: z.string(),
  fromId: z.string(),
  toId: z.string(),
  modelName: z.string(),
  destinationName: z.string(),
  options: ReverseSyncOptions,
  settingsLocked: z.boolean(),
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
