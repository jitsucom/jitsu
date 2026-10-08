-- Operator-only, state-preserving migration. Stop console mutations, suspend
-- Reverse ETL scheduling and drain workers first. Never run alongside old binaries.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v schema=newjitsu -f per-run-control.sql
BEGIN;
SET LOCAL search_path TO :"schema";
LOCK TABLE reverse_sync_control IN ACCESS EXCLUSIVE MODE;
ALTER TABLE reverse_sync_control ADD COLUMN IF NOT EXISTS run_order bigint NOT NULL DEFAULT 0;
ALTER TABLE reverse_sync_control ADD COLUMN IF NOT EXISTS detached boolean NOT NULL DEFAULT false;
ALTER TABLE reverse_sync_control DROP CONSTRAINT reverse_sync_control_pkey;
ALTER TABLE reverse_sync_control ADD PRIMARY KEY (workspace_id, sync_id, run_id);
DROP INDEX IF EXISTS reverse_sync_control_sync_id_key;
CREATE INDEX IF NOT EXISTS reverse_sync_control_sync_id_idx ON reverse_sync_control(sync_id);
CREATE UNIQUE INDEX IF NOT EXISTS reverse_sync_control_workspace_id_sync_id_run_order_key
  ON reverse_sync_control(workspace_id, sync_id, run_order);
COMMIT;
