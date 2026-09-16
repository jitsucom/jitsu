import type { JsonObject, ResumePoint } from "@jitsu/protocols/reverse-etl";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { Database } from "./database";
import { decodeJson } from "./serialization";
import type { ControlRow, StateRow, TargetOwnerRow } from "./rows";
import { ensure, type RunInput, type Scope } from "./types";
import { controlFor } from "./control-cache";
export { readControl, lockControl } from "./control-cache";

export interface SavedState {
  point: ResumePoint;
  store: JsonObject;
  generation?: string;
}
export const stateStream = "_REVERSE_ETL_";
/** JSON text inside jsonb preserves NUL/unpaired-surrogate strings supported by the protocol. */
export function readSavedState(value: unknown, scope: RunInput): SavedState {
  ensure(value !== null && typeof value === "object" && !Array.isArray(value), "Unsupported saved state format");
  const envelope = value as Record<string, unknown>;
  ensure(envelope?.version === 2 && typeof envelope.value === "string", "Unsupported saved state format");
  ensure(
    envelope.workspaceId === scope.workspaceId &&
      envelope.revision === scope.configRevision &&
      envelope.targetHash === contentHash(scope.targetIdentity),
    "Saved state scope mismatch"
  );
  return decodeJson<SavedState>(Buffer.from(envelope.value, "utf8"));
}

/** Open durable lifecycle state after Kubernetes admission; this does not acquire a database lease. */
export async function openRun(db: Database, input: RunInput): Promise<{ scope: Scope; recovery: boolean }> {
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
  // Capture caller-owned fields before any await.
  const run = { ...input };
  const cache = controlFor(db, run);
  return cache.transaction(async client => {
    cache.invalidate();
    const target = contentHash(run.targetIdentity);
    // Serialize target admission too: an upsert cannot race exclusive mirror ownership.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [target]);
    await client.query(
      `INSERT INTO reverse_sync_control (workspace_id,sync_id,run_id,revision,target_hash,mode,extraction)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (workspace_id,sync_id) DO NOTHING`,
      [run.workspaceId, run.syncId, run.logicalRunId, run.configRevision, target, run.mode, run.extraction]
    );
    const {
      rows: [control],
    } = await client.query<ControlRow>(
      "SELECT * FROM reverse_sync_control WHERE workspace_id=$1 AND sync_id=$2 FOR UPDATE",
      [run.workspaceId, run.syncId]
    );
    ensure(
      control.target_hash === target && control.revision === run.configRevision && control.mode === run.mode,
      "Target/config changes require controlled reset"
    );
    const sameRun = control.run_id === run.logicalRunId;
    ensure(sameRun || ["complete", "aborted"].includes(control.phase), "Previous logical run requires recovery");
    if (sameRun) {
      ensure(!["complete", "aborted"].includes(control.phase), "Logical run already ended; use a new run ID");
      ensure(control.extraction === run.extraction, "Recovery must preserve the original run configuration");
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
      const owner = await client.query<Pick<TargetOwnerRow, "workspace_id" | "sync_id">>(
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
      const saved = await client.query<Pick<StateRow, "state">>(
        `SELECT state FROM ${db.stateTable} WHERE sync_id=$1 AND stream=$2`,
        [run.syncId, stateStream]
      );
      if (saved.rows[0]) {
        const value = readSavedState(saved.rows[0].state, run);
        base = run.extraction === "cursor" && value.point.cursor ? value.point.sourceSequence : 0;
      }
    }
    const updated = await client.query<ControlRow>(
      `UPDATE reverse_sync_control SET run_id=$3, extraction=$4,
      phase=CASE WHEN $5 THEN phase ELSE 'new' END,
      base_sequence=CASE WHEN $5 AND phase <> 'new' THEN base_sequence ELSE $6 END,
      next_sequence=CASE WHEN $5 AND phase <> 'new' THEN next_sequence ELSE $6 END,
      checkpoint_sequence=CASE WHEN $5 AND phase <> 'new' THEN checkpoint_sequence ELSE $6 END,
      finish_sequence=CASE WHEN $5 THEN finish_sequence ELSE NULL END,
      finish_result=CASE WHEN $5 THEN finish_result ELSE NULL END
      WHERE workspace_id=$1 AND sync_id=$2 RETURNING *`,
      [run.workspaceId, run.syncId, run.logicalRunId, run.extraction, sameRun, base]
    );
    cache.remember(updated.rows[0]);
    return {
      scope: Object.freeze(run),
      recovery: sameRun && control.phase !== "new",
    };
  });
}
