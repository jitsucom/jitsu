import type { JsonObject, ResumePoint } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { Database } from "./database";
import { ensure, type RunInput, type Scope } from "./types";

export interface SavedState {
  point: ResumePoint;
  store: JsonObject;
  generation?: string;
}
export const stateStream = "_REVERSE_ETL_";
export function statePurpose(scope: RunInput) {
  return `state:${contentHash(scope.targetIdentity)}:${scope.configRevision}`;
}

/** Caller must already hold the matching Kubernetes sync lease. This is the DB fence, not admission. */
export async function acquire(
  db: Database,
  input: RunInput,
  leaseMs = 60_000
): Promise<{ scope: Scope; recovery: boolean }> {
  for (const value of [
    input.workspaceId,
    input.syncId,
    input.taskId,
    input.logicalRunId,
    input.configRevision,
    input.targetIdentity,
  ])
    ensure(typeof value === "string" && value.length > 0 && value.length <= 512, "Invalid run scope");
  ensure(
    ["upsert", "mirror"].includes(input.mode) && ["cursor", "full"].includes(input.extraction),
    "Invalid extraction mode"
  );
  ensure(input.mode !== "mirror" || input.extraction === "full", "Mirror requires full extraction");
  ensure(Number.isSafeInteger(leaseMs) && leaseMs >= 100 && leaseMs <= 60_000, "Invalid lease duration");
  const start = new Date(input.billingPeriod.start);
  const end = new Date(input.billingPeriod.end);
  ensure(
    start instanceof Date && end instanceof Date && Number.isFinite(+start) && +end > +start,
    "Invalid billing period"
  );
  // Detach caller-owned mutable fields before any await.
  const run = { ...input, billingPeriod: { start: new Date(start), end: new Date(end) } };
  return db.transaction(async client => {
    const target = contentHash(run.targetIdentity);
    // Serialize target admission too: an upsert cannot race exclusive mirror ownership.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [target]);
    await client.query(
      `INSERT INTO reverse_sync_control (workspace_id,sync_id,run_id,task_id,revision,target_hash,lease_until,mode,extraction,billing_period_start,billing_period_end)
      VALUES ($1,$2,$3,$4,$5,$6,clock_timestamp(),$7,$8,$9,$10) ON CONFLICT (workspace_id,sync_id) DO NOTHING`,
      [
        run.workspaceId,
        run.syncId,
        run.logicalRunId,
        run.taskId,
        run.configRevision,
        target,
        run.mode,
        run.extraction,
        start,
        end,
      ]
    );
    const {
      rows: [control],
    } = await client.query(
      "SELECT *, lease_until > clock_timestamp() AS active FROM reverse_sync_control WHERE workspace_id=$1 AND sync_id=$2 FOR UPDATE",
      [run.workspaceId, run.syncId]
    );
    ensure(!control.active, "Sync already has an active owner");
    ensure(
      control.target_hash === target && control.revision === run.configRevision && control.mode === run.mode,
      "Target/config changes require controlled reset"
    );
    const sameRun = control.run_id === run.logicalRunId;
    ensure(sameRun || ["complete", "aborted"].includes(control.phase), "Previous logical run requires recovery");
    if (sameRun) {
      ensure(!["complete", "aborted"].includes(control.phase), "Logical run already ended; use a new run ID");
      ensure(
        control.extraction === run.extraction &&
          +control.billing_period_start === +start &&
          +control.billing_period_end === +end,
        "Recovery must preserve the original run configuration"
      );
    }
    if (run.mode === "mirror") {
      const other = await client.query(
        "SELECT 1 FROM reverse_sync_control WHERE target_hash=$1 AND (workspace_id<>$2 OR sync_id<>$3) LIMIT 1",
        [target, run.workspaceId, run.syncId]
      );
      ensure(!other.rowCount, "Audience already belongs to another mirror or upsert sync");
      await client.query(
        "INSERT INTO reverse_sync_target_owner (target_hash,workspace_id,sync_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
        [target, run.workspaceId, run.syncId]
      );
      const owner = await client.query(
        "SELECT workspace_id,sync_id FROM reverse_sync_target_owner WHERE target_hash=$1",
        [target]
      );
      ensure(
        owner.rows[0]?.workspace_id === run.workspaceId && owner.rows[0]?.sync_id === run.syncId,
        "Audience already belongs to another mirror sync"
      );
    } else {
      const owner = await client.query("SELECT 1 FROM reverse_sync_target_owner WHERE target_hash=$1", [target]);
      ensure(!owner.rowCount, "Audience is exclusively managed by a mirror sync");
    }
    let base = 0;
    if (!sameRun || control.phase === "new") {
      const saved = await client.query(`SELECT state FROM ${db.stateTable} WHERE sync_id=$1 AND stream=$2`, [
        run.syncId,
        stateStream,
      ]);
      if (saved.rows[0]) {
        const envelope = saved.rows[0].state;
        ensure(
          envelope.workspaceId === run.workspaceId &&
            envelope.revision === run.configRevision &&
            envelope.targetHash === target,
          "Saved state scope mismatch"
        );
        const value = db.cipher.open<SavedState>(Buffer.from(envelope.value, "base64"), db.aad(run, statePurpose(run)));
        base = run.extraction === "cursor" && value.point.cursor ? value.point.sourceSequence : 0;
      }
    }
    const updated = await client.query(
      `UPDATE reverse_sync_control SET epoch=epoch+1, task_id=$3, lease_until=clock_timestamp()+($4 * interval '1 millisecond'),
      run_id=$5, extraction=$6, billing_period_start=$7,billing_period_end=$8,
      phase=CASE WHEN $9 THEN phase ELSE 'new' END,
      base_sequence=CASE WHEN $9 AND phase <> 'new' THEN base_sequence ELSE $10 END,
      next_sequence=CASE WHEN $9 AND phase <> 'new' THEN next_sequence ELSE $10 END,
      checkpoint_sequence=CASE WHEN $9 AND phase <> 'new' THEN checkpoint_sequence ELSE $10 END,
      finish_sequence=CASE WHEN $9 THEN finish_sequence ELSE NULL END,
      finish_result=CASE WHEN $9 THEN finish_result ELSE NULL END
      WHERE workspace_id=$1 AND sync_id=$2 RETURNING epoch`,
      [run.workspaceId, run.syncId, run.taskId, leaseMs, run.logicalRunId, run.extraction, start, end, sameRun, base]
    );
    return {
      scope: Object.freeze({ ...run, fencingEpoch: updated.rows[0].epoch }),
      recovery: sameRun && control.phase !== "new",
    };
  });
}

export async function renew(db: Database, scope: Scope, leaseMs = 60_000) {
  ensure(Number.isSafeInteger(leaseMs) && leaseMs >= 100 && leaseMs <= 60_000, "Invalid lease duration");
  await db.owned(scope, async client => {
    const result = await client.query(
      "UPDATE reverse_sync_control SET lease_until=clock_timestamp()+($3 * interval '1 millisecond') WHERE workspace_id=$1 AND sync_id=$2 AND lease_until>clock_timestamp() RETURNING 1",
      [scope.workspaceId, scope.syncId, leaseMs]
    );
    ensure(result.rowCount, "Run ownership lost");
  });
}
/** Release does not mark success, clear a pending submission, or abandon mirror ownership. */
export async function release(db: Database, scope: Scope) {
  await db.transaction(async client => {
    const result = await client.query(
      `UPDATE reverse_sync_control SET epoch=epoch+1,task_id='',lease_until=clock_timestamp()
      WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND task_id=$4 AND epoch=$5 AND revision=$6 AND target_hash=$7 AND lease_until>clock_timestamp() RETURNING 1`,
      [
        scope.workspaceId,
        scope.syncId,
        scope.logicalRunId,
        scope.taskId,
        scope.fencingEpoch,
        scope.configRevision,
        contentHash(scope.targetIdentity),
      ]
    );
    ensure(result.rowCount, "Run ownership lost");
  });
}
