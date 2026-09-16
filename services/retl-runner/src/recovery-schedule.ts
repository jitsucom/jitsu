import { z } from "zod";

// Stored in source_task.metrics.reverseRecovery, not provider state. syncctl
// only launches checks; Node remains responsible for admission and delivery.
export const RecoverySchedule = z.object({
  runId: z.string().min(1),
  revision: z.string().min(1),
  attempt: z.number().int().min(0).max(100),
  deadline: z.string().datetime(),
  nextCheckAt: z.string().datetime(),
});
export type RecoverySchedule = z.infer<typeof RecoverySchedule>;

export function nextRecoveryCheck(runId: string, revision: string, previous?: RecoverySchedule, now = Date.now()) {
  const deadline = previous ? Date.parse(previous.deadline) : now + 24 * 60 * 60_000;
  if (now >= deadline) return undefined;
  const attempt = previous ? Math.min(previous.attempt + 1, 100) : 0;
  const delay = Math.min(60, 30 * 1.3 ** attempt) * 60_000;
  return {
    runId,
    revision,
    attempt,
    deadline: new Date(deadline).toISOString(),
    nextCheckAt: new Date(Math.min(now + delay, deadline)).toISOString(),
  };
}
