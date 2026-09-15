import { Database } from "./database";
import { ensure, type Scope } from "./types";

/** Bounded, lease-fenced retention. Never erase current recovery or the committed snapshot. */
export async function prune(db: Database, scope: Scope, receiptsBefore: Date) {
  ensure(
    Number.isFinite(+receiptsBefore) && +receiptsBefore <= Date.now() - 86400000,
    "Receipt retention must preserve at least 24 hours"
  );
  return db.owned(scope, async (client, control) => {
    const key = [scope.workspaceId, scope.syncId, scope.logicalRunId];
    let snapshotRows = 0;
    // Table names are a closed, code-owned list, never caller input.
    for (const table of ["source_key", "desired"]) {
      const result = await client.query(
        `DELETE FROM reverse_sync_${table} WHERE ctid IN (
        SELECT ctid FROM reverse_sync_${table} WHERE workspace_id=$1 AND sync_id=$2 AND generation<>$3
        AND generation IS DISTINCT FROM $4 LIMIT 1000)`,
        [...key, control.committed_generation]
      );
      snapshotRows += result.rowCount ?? 0;
    }
    await client.query(
      `DELETE FROM reverse_sync_generation g WHERE g.workspace_id=$1 AND g.sync_id=$2 AND g.generation<>$3 AND g.generation IS DISTINCT FROM $4
      AND NOT EXISTS (SELECT 1 FROM reverse_sync_source_key k WHERE k.workspace_id=g.workspace_id AND k.sync_id=g.sync_id AND k.generation=g.generation)
      AND NOT EXISTS (SELECT 1 FROM reverse_sync_desired d WHERE d.workspace_id=g.workspace_id AND d.sync_id=g.sync_id AND d.generation=g.generation)`,
      [...key, control.committed_generation]
    );
    const batches = await client.query(
      `SELECT b.run_id,b.batch_id,octet_length(b.manifest)+b.result_bytes AS bytes FROM reverse_sync_batch b
      WHERE b.workspace_id=$1 AND b.sync_id=$2 AND b.run_id<>$3 AND b.created_at<$4
      AND NOT EXISTS (SELECT 1 FROM reverse_sync_operation o WHERE o.workspace_id=b.workspace_id AND o.sync_id=b.sync_id AND o.run_id=b.run_id AND o.batch_id=b.batch_id AND o.status IN ('prepared','unknown','staged'))
      ORDER BY b.created_at,b.batch_id LIMIT 100`,
      [...key, receiptsBefore]
    );
    let freed = 0;
    for (const batch of batches.rows) {
      const rows = await client.query(
        "DELETE FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4 RETURNING octet_length(effects) AS bytes",
        [...key.slice(0, 2), batch.run_id, batch.batch_id]
      );
      freed += Number(batch.bytes) + rows.rows.reduce((n, row) => n + row.bytes, 0);
      await client.query(
        "DELETE FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4",
        [...key.slice(0, 2), batch.run_id, batch.batch_id]
      );
    }
    await client.query(
      "UPDATE reverse_sync_control SET journal_bytes=journal_bytes-$3 WHERE workspace_id=$1 AND sync_id=$2",
      [...key.slice(0, 2), freed]
    );
    return { batches: batches.rowCount ?? 0, snapshotRows };
  });
}
