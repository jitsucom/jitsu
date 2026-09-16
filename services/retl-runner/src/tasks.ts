import { randomUUID } from "node:crypto";
import { Database } from "./persistence";
import { ensure } from "./persistence/types";

export class Tasks {
  constructor(private readonly db: Database, readonly syncId: string, readonly taskId: string) {}
  async start(trigger: "manual" | "scheduled") {
    await this.db.transaction(async client => {
      const result = await client.query(
        `INSERT INTO source_task(sync_id,task_id,package,version,status,started_by)
         VALUES($1,$2,'jitsu/retl-runner','1','RUNNING',$3) ON CONFLICT(task_id) DO NOTHING RETURNING 1`,
        [this.syncId, this.taskId, { trigger, kind: "reverse" }]
      );
      ensure(result.rowCount, "Task already exists");
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
  async finish(status: "SUCCESS" | "FAILED" | "CANCELLED", message: string) {
    return this.db.transaction(async client => {
      const changed = await client.query(
        "UPDATE source_task SET status=$3,description=$4,error=$5,updated_at=clock_timestamp() WHERE sync_id=$1 AND task_id=$2 AND status='RUNNING' RETURNING 1",
        [this.syncId, this.taskId, status, message, status === "FAILED" ? message : null]
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
