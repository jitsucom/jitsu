import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export async function seedPendingReverseRun(
  prisma: PrismaClient,
  syncId: string,
  workspaceId: string,
  revision: string
) {
  const taskId = randomUUID(),
    runId = randomUUID();
  await prisma.reverse_sync_control.create({
    data: {
      workspace_id: workspaceId,
      sync_id: syncId,
      run_id: runId,
      revision,
      target_hash: "test-target",
      mode: "upsert",
      extraction: "full",
      phase: "batches_pending",
      detached: true,
    },
  });
  await prisma.source_task.create({
    data: {
      sync_id: syncId,
      task_id: taskId,
      package: "jitsu/retl-runner",
      version: "1",
      status: "PENDING",
      started_by: { workspaceId },
      metrics: { reverseRecovery: { runId, revision } },
    },
  });
  return { refreshTaskId: taskId };
}
