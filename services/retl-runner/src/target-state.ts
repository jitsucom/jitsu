import type { ScopedTargetState } from "@jitsu/protocols/reverse-etl-runtime";
import type { Database } from "./persistence/database";
import { ensure } from "./persistence/types";

/** Sync scope is supplied by the runner, never by the provider's stored JSON. */
export function createTargetState(
  db: Database,
  scope: { workspaceId: string; id: string },
  stream: string
): ScopedTargetState {
  return {
    read: () =>
      db.transaction(async client => {
        const result = await client.query("SELECT state FROM source_state WHERE sync_id=$1 AND stream=$2", [
          scope.id,
          stream,
        ]);
        return result.rows[0]?.state;
      }),
    create: value =>
      db.transaction(async client => {
        const existing = await client.query("SELECT 1 FROM reverse_sync_control WHERE workspace_id=$1 AND sync_id=$2", [
          scope.workspaceId,
          scope.id,
        ]);
        ensure(!existing.rowCount, "Managed audience state is missing; preserve delivery state and reconcile");
        await client.query(
          "INSERT INTO source_state(sync_id,stream,state,timestamp) VALUES($1,$2,$3,clock_timestamp()) ON CONFLICT(sync_id,stream) DO NOTHING",
          [scope.id, stream, JSON.stringify(value)]
        );
      }),
    compareAndSet: (expected, value) =>
      db.transaction(async client => {
        const result = await client.query(
          "UPDATE source_state SET state=$3,timestamp=clock_timestamp() WHERE sync_id=$1 AND stream=$2 AND state=$4::jsonb",
          [scope.id, stream, JSON.stringify(value), JSON.stringify(expected)]
        );
        return result.rowCount === 1;
      }),
  };
}
