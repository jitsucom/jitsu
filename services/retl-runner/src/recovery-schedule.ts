import { z } from "zod";

// Stored in source_task.metrics.reverseRecovery, not provider state. syncctl
// only launches checks; Node remains responsible for admission and delivery.
export const RecoverySchedule = z.object({
  runId: z.string().min(1),
  revision: z.string().min(1),
  // Also used as a worker generation in syncctl's PostgreSQL int fields.
  attempt: z.number().int().min(0).max(2147483647),
  deadline: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  suspended: z.boolean().optional(),
  nextCheckAt: z.string().datetime(),
});
export type RecoverySchedule = z.infer<typeof RecoverySchedule>;

export function nextRecoveryCheck(runId: string, revision: string, previous?: RecoverySchedule, now = Date.now()) {
  const day = 24 * 60 * 60_000;
  // Old schedules stored only a 24h deadline. Extend once from that original window, never from a manual refresh.
  const started = previous ? Date.parse(previous.startedAt ?? previous.deadline) - (previous.startedAt ? 0 : day) : now;
  const deadline = started + 2 * day;
  if (now >= deadline || (previous && previous.attempt >= 2147483647)) return undefined;
  const attempt = previous ? previous.attempt + 1 : 0;
  const delay = (now >= started + day ? 120 : Math.min(60, 30 * 1.3 ** attempt)) * 60_000;
  return {
    runId,
    revision,
    attempt,
    startedAt: new Date(started).toISOString(),
    deadline: new Date(deadline).toISOString(),
    nextCheckAt: new Date(Math.min(now + delay, deadline)).toISOString(),
  };
}
