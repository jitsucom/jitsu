import { randomUUID } from "node:crypto";
import { Database } from "./persistence";
import { ensure } from "./persistence/types";
import { RecoverySchedule, nextRecoveryCheck } from "./recovery-schedule";
import type { ReverseDeliveryStats } from "@jitsu/protocols/reverse-etl-stats";

export type TaskResult = "COMPLETE" | "FAILED" | "CANCELLED" | "PENDING";

export class Tasks {
  constructor(
    private readonly db: Database,
    readonly syncId: string,
    readonly taskId: string,
    readonly workspaceId?: string,
    readonly workerId: string = taskId
  ) {}
  // Called only while holding the Kubernetes lease. The conditional parent
  // transition also makes cancellation win over an already queued recovery Pod.
  async start(
    trigger: "manual" | "scheduled" | "recovery",
    recoveryOf?: string,
    revision?: string,
    refreshAttempt?: number
  ) {
    return this.db.transaction(async client => {
      if (trigger === "recovery") {
        ensure(recoveryOf === this.taskId && revision, "Recovery task binding required");
        const parent = await client.query<{ run_id: string }>(
          `UPDATE source_task t SET status='PENDING',updated_at=clock_timestamp(),
           metrics=jsonb_set(t.metrics,'{reverseWorker}',$5::jsonb || jsonb_build_object(
             'previousStatus',COALESCE(t.metrics->'reverseRecovery'->>'previousStatus',t.status)))
           FROM reverse_sync_control c WHERE t.sync_id=$1 AND t.task_id=$2 AND t.status IN ('PENDING','WAITING')
           AND COALESCE((t.metrics->'reverseRecovery'->>'suspended')::boolean,false)=false
           AND COALESCE((t.metrics->'reverseWorker'->>'active')::boolean,false)=false
           AND t.started_by->>'workspaceId'=$3 AND c.workspace_id=$3 AND c.sync_id=t.sync_id
           AND c.run_id=t.metrics->'reverseRecovery'->>'runId' AND c.revision=$4
           AND c.revision=t.metrics->'reverseRecovery'->>'revision'
           AND c.phase NOT IN ('complete','aborted')
           AND ($6::int IS NULL OR (t.metrics->'reverseRecovery'->>'attempt')::int=$6)
           AND (t.metrics->'reverseRecovery'->>'nextCheckAt')::timestamptz<=clock_timestamp() RETURNING c.run_id`,
          [
            this.syncId,
            recoveryOf,
            this.workspaceId,
            revision,
            { id: this.workerId, active: true },
            refreshAttempt ?? null,
          ]
        );
        ensure(parent.rowCount, "Recovery no longer scheduled");
        return parent.rows[0].run_id;
      }
      const pending = await client.query(
        `SELECT 1 FROM source_task t JOIN reverse_sync_control c
        ON c.sync_id=t.sync_id AND c.workspace_id=$2 AND c.run_id=t.metrics->'reverseRecovery'->>'runId'
        WHERE t.sync_id=$1 AND t.package='jitsu/retl-runner' AND t.status IN ('WAITING','PENDING')
        AND NOT c.detached AND c.phase NOT IN ('complete','aborted') LIMIT 1`,
        [this.syncId, this.workspaceId]
      );
      // Manual and cron Pods must not take over a logical task through a new ID.
      // The existing task's automatic/explicit refresh is its continuation path.
      ensure(!pending.rowCount, "An incomplete run is awaiting its status refresh");
      const result = await client.query(
        `INSERT INTO source_task(sync_id,task_id,package,version,status,started_by,metrics)
         VALUES($1,$2,'jitsu/retl-runner','1','RUNNING',$3,$4) ON CONFLICT(task_id) DO NOTHING RETURNING 1`,
        [
          this.syncId,
          this.taskId,
          { trigger, kind: "reverse", workspaceId: this.workspaceId, ...(recoveryOf ? { recoveryOf } : {}) },
          { reverseWorker: { id: this.workerId, active: true } },
        ]
      );
      ensure(result.rowCount, "Task already exists");
      return undefined;
    });
  }
  async heartbeat() {
    await this.db.transaction(async client => {
      const result = await client.query(
        "UPDATE source_task SET updated_at=clock_timestamp() WHERE sync_id=$1 AND task_id=$2 AND status IN ('RUNNING','PENDING') AND metrics->'reverseWorker'->>'id'=$3 AND (metrics->'reverseWorker'->>'active')::boolean RETURNING 1",
        [this.syncId, this.taskId, this.workerId]
      );
      ensure(result.rowCount, "Task cancelled or ended");
    });
  }
  async statistics(stats: ReverseDeliveryStats) {
    await this.db.transaction(async client => {
      await client.query(
        "UPDATE source_task SET metrics=COALESCE(metrics,'{}'::jsonb) || $3::jsonb WHERE sync_id=$1 AND task_id=$2 AND status IN ('RUNNING','PENDING') AND metrics->'reverseWorker'->>'id'=$4 AND (metrics->'reverseWorker'->>'active')::boolean",
        [this.syncId, this.taskId, { reverseDelivery: stats }, this.workerId]
      );
    });
  }
  async progress(message: string) {
    await this.db.transaction(async client => {
      const result = await client.query(
        "UPDATE source_task SET description=$3 WHERE sync_id=$1 AND task_id=$2 AND status IN ('RUNNING','PENDING') AND metrics->'reverseWorker'->>'id'=$4 AND (metrics->'reverseWorker'->>'active')::boolean RETURNING 1",
        [this.syncId, this.taskId, message, this.workerId]
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
    const status = schedule ? "PENDING" : "FAILED";
    const changed = await this.finish(
      status,
      schedule
        ? `Provider processing pending; next check at ${schedule.nextCheckAt}`
        : "Provider processing still pending after 24 hours; automatic checks stopped, delivery state retained",
      schedule ?? previous
    );
    return changed ? status : "FAILED";
  }
  /** A failed check is not evidence that delivery failed. Finish only this worker. */
  async refreshFailed(message: string, stopAutomaticChecks = false): Promise<TaskResult> {
    return this.db.transaction(async client => {
      const current = await client.query<{ status: string; previous: string; schedule: unknown }>(
        `SELECT status,COALESCE(metrics->'reverseWorker'->>'previousStatus',status) AS previous,
         metrics->'reverseRecovery' AS schedule FROM source_task
         WHERE sync_id=$1 AND task_id=$2 AND status IN ('PENDING','WAITING')
         AND metrics->'reverseWorker'->>'id'=$3 AND (metrics->'reverseWorker'->>'active')::boolean FOR UPDATE`,
        [this.syncId, this.taskId, this.workerId]
      );
      if (!current.rowCount) return "FAILED"; // Cancellation or a newer worker won.
      const previous = RecoverySchedule.parse(current.rows[0].schedule);
      const next = nextRecoveryCheck(previous.runId, previous.revision, previous);
      const suspended = stopAutomaticChecks || !next;
      const schedule = { ...(next ?? previous), ...(suspended ? { suspended: true } : {}) };
      const status = current.rows[0].previous;
      ensure(["WAITING", "PENDING", "FAILED", "CANCELLED"].includes(status), "Invalid previous refresh status");
      const detail = `${message} ${
        suspended || status === "FAILED" || status === "CANCELLED"
          ? "Automatic status checks stopped; saved delivery retained."
          : `Saved delivery retained; next status check at ${schedule.nextCheckAt}.`
      }`;
      await client.query(
        `UPDATE source_task SET status=$3,updated_at=clock_timestamp(),
         metrics=metrics || $4::jsonb WHERE sync_id=$1 AND task_id=$2`,
        [
          this.syncId,
          this.taskId,
          status,
          { reverseRecovery: schedule, reverseWorker: { id: this.workerId, active: false } },
        ]
      );
      await client.query(
        "INSERT INTO task_log(id,level,logger,message,sync_id,task_id) VALUES($1,'ERROR','retl-runner',$2,$3,$4)",
        [randomUUID(), detail, this.syncId, this.taskId]
      );
      return status === "FAILED" || status === "CANCELLED" ? status : "PENDING";
    });
  }
  async logError(message: string) {
    await this.db.transaction(client =>
      client.query(
        `INSERT INTO task_log(id,level,logger,message,sync_id,task_id)
       SELECT $1,'ERROR','retl-runner',$2,sync_id,task_id FROM source_task
       WHERE sync_id=$3 AND task_id=$4 AND metrics->'reverseWorker'->>'id'=$5`,
        [randomUUID(), message, this.syncId, this.taskId, this.workerId]
      )
    );
  }
  async finish(status: TaskResult, message: string, schedule?: RecoverySchedule) {
    return this.db.transaction(async client => {
      const changed = await client.query(
        "UPDATE source_task SET status=$3,description=$4,error=$5,metrics=(CASE WHEN $3='FAILED' THEN COALESCE(metrics,'{}'::jsonb) ELSE COALESCE(metrics,'{}'::jsonb)-'reverseRecovery' END) || $6::jsonb,updated_at=clock_timestamp() WHERE sync_id=$1 AND task_id=$2 AND status IN ('RUNNING','PENDING') AND metrics->'reverseWorker'->>'id'=$7 AND (metrics->'reverseWorker'->>'active')::boolean RETURNING 1",
        [
          this.syncId,
          this.taskId,
          status,
          message,
          status === "FAILED" ? message : null,
          { ...(schedule ? { reverseRecovery: schedule } : {}), reverseWorker: { id: this.workerId, active: false } },
          this.workerId,
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
