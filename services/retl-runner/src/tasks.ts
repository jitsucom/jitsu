import { randomUUID } from "node:crypto";
import { Database } from "./persistence";
import { ensure } from "./persistence/types";
import { RecoverySchedule, nextRecoveryCheck } from "./recovery-schedule";

export type TaskResult = "SUCCESS" | "FAILED" | "CANCELLED" | "WAITING";

export class Tasks {
  constructor(
    private readonly db: Database,
    readonly syncId: string,
    readonly taskId: string,
    readonly workspaceId?: string
  ) {}
  // Called only while holding the Kubernetes lease. The conditional parent
  // transition also makes cancellation win over an already queued recovery Pod.
  async start(trigger: "manual" | "scheduled" | "recovery", recoveryOf?: string, revision?: string) {
    await this.db.transaction(async client => {
      if (trigger === "recovery") {
        ensure(recoveryOf && revision, "Recovery task binding required");
        const parent = await client.query(
          `UPDATE source_task t SET status='RESUMED',updated_at=clock_timestamp()
           FROM reverse_sync_control c WHERE t.sync_id=$1 AND t.task_id=$2 AND t.status='WAITING'
           AND t.started_by->>'workspaceId'=$3 AND c.workspace_id=$3 AND c.sync_id=t.sync_id
           AND c.run_id=t.metrics->'reverseRecovery'->>'runId' AND c.revision=$4
           AND c.revision=t.metrics->'reverseRecovery'->>'revision'
           AND c.phase NOT IN ('complete','aborted')
           AND (t.metrics->'reverseRecovery'->>'nextCheckAt')::timestamptz<=clock_timestamp() RETURNING 1`,
          [this.syncId, recoveryOf, this.workspaceId, revision]
        );
        ensure(parent.rowCount, "Recovery no longer scheduled");
      }
      const result = await client.query(
        `INSERT INTO source_task(sync_id,task_id,package,version,status,started_by)
         VALUES($1,$2,'jitsu/retl-runner','1','RUNNING',$3) ON CONFLICT(task_id) DO NOTHING RETURNING 1`,
        [
          this.syncId,
          this.taskId,
          { trigger, kind: "reverse", workspaceId: this.workspaceId, ...(recoveryOf ? { recoveryOf } : {}) },
        ]
      );
      ensure(result.rowCount, "Task already exists");
      // A manual/cron attempt also supersedes queued checks for this sync. A
      // stale recovery Pod cannot start or reopen extraction after this point.
      await client.query(
        "UPDATE source_task SET status='RESUMED',updated_at=clock_timestamp() WHERE sync_id=$1 AND package='jitsu/retl-runner' AND status='WAITING'",
        [this.syncId]
      );
    });
  }
  async heartbeat() {
    await this.db.transaction(async client => {
      const result = await client.query(
        "UPDATE source_task SET updated_at=clock_timestamp() WHERE sync_id=$1 AND task_id=$2 AND status='RUNNING' RETURNING 1",
        [this.syncId, this.taskId]
      );
      ensure(result.rowCount, "Task cancelled or ended");
    });
  }
  async progress(message: string) {
    await this.db.transaction(async client => {
      const result = await client.query(
        "UPDATE source_task SET description=$3 WHERE sync_id=$1 AND task_id=$2 AND status='RUNNING' RETURNING 1",
        [this.syncId, this.taskId, message]
      );
      ensure(result.rowCount, "Task cancelled or ended");
      await client.query(
        "INSERT INTO task_log(id,level,logger,message,sync_id,task_id) VALUES($1,'INFO','retl-runner',$2,$3,$4)",
        [randomUUID(), message, this.syncId, this.taskId]
      );
    });
  }
  async wait(runId: string, revision: string): Promise<TaskResult> {
    const previous = await this.db.transaction(async client => {
      const result = await client.query<{ schedule: unknown }>(
        `SELECT metrics->'reverseRecovery' AS schedule FROM source_task
         WHERE sync_id=$1 AND package='jitsu/retl-runner' AND metrics->'reverseRecovery'->>'runId'=$2
         ORDER BY started_at DESC,task_id DESC LIMIT 1`,
        [this.syncId, runId]
      );
      return result.rows[0] ? RecoverySchedule.parse(result.rows[0].schedule) : undefined;
    });
    const schedule = nextRecoveryCheck(runId, revision, previous);
    const status = schedule ? "WAITING" : "FAILED";
    const changed = await this.finish(
      status,
      schedule
        ? `Provider processing pending; next check at ${schedule.nextCheckAt}`
        : "Provider processing still pending after 24 hours; automatic checks stopped, delivery state retained",
      schedule ?? previous
    );
    return changed ? status : "FAILED";
  }
  async finish(status: TaskResult, message: string, schedule?: RecoverySchedule) {
    return this.db.transaction(async client => {
      const changed = await client.query(
        "UPDATE source_task SET status=$3,description=$4,error=$5,metrics=COALESCE($6::jsonb,metrics),updated_at=clock_timestamp() WHERE sync_id=$1 AND task_id=$2 AND status='RUNNING' RETURNING 1",
        [
          this.syncId,
          this.taskId,
          status,
          message,
          status === "FAILED" ? message : null,
          schedule ? { reverseRecovery: schedule } : null,
        ]
      );
      if (changed.rowCount)
        await client.query(
          "INSERT INTO task_log(id,level,logger,message,sync_id,task_id) VALUES($1,$2,'retl-runner',$3,$4,$5)",
          [randomUUID(), status === "FAILED" ? "ERROR" : "INFO", message, this.syncId, this.taskId]
        );
      return !!changed.rowCount;
    });
  }
}
