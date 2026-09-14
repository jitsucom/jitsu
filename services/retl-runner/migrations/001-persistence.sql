-- Run once using migration credentials, against the configuration database.
-- Separate schema: console's Prisma db push must not manage journal retention.
BEGIN;
CREATE SCHEMA retl;
REVOKE ALL ON SCHEMA retl FROM PUBLIC;

CREATE TABLE retl.control (
  workspace_id text NOT NULL,
  sync_id text NOT NULL UNIQUE,
  run_id text NOT NULL,
  task_id text NOT NULL,
  revision text NOT NULL,
  target_hash text NOT NULL,
  epoch bigint NOT NULL DEFAULT 1,
  lease_until timestamptz NOT NULL,
  phase text NOT NULL DEFAULT 'new',
  mode text NOT NULL CHECK (mode IN ('upsert', 'mirror')),
  extraction text NOT NULL CHECK (extraction IN ('cursor', 'full')),
  base_sequence bigint NOT NULL DEFAULT 0,
  next_sequence bigint NOT NULL DEFAULT 0,
  checkpoint_sequence bigint NOT NULL DEFAULT 0,
  finish_sequence bigint,
  store bytea,
  provider_state bytea,
  finish_result bytea,
  committed_generation text,
  membership_entries bigint NOT NULL DEFAULT 0,
  membership_bytes bigint NOT NULL DEFAULT 0,
  journal_bytes bigint NOT NULL DEFAULT 0,
  reserved_entries bigint NOT NULL DEFAULT 0,
  reserved_bytes bigint NOT NULL DEFAULT 0,
  billing_period_start timestamptz NOT NULL,
  billing_period_end timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, sync_id),
  CHECK (billing_period_end > billing_period_start)
);
-- Persistent exclusive audience ownership. Lease expiry does not release it.
CREATE TABLE retl.target_owner (
  target_hash text PRIMARY KEY,
  workspace_id text NOT NULL,
  sync_id text NOT NULL,
  UNIQUE (workspace_id, sync_id)
);
CREATE TABLE retl.batch (
  workspace_id text NOT NULL, sync_id text NOT NULL, run_id text NOT NULL,
  batch_id text NOT NULL,
  manifest bytea NOT NULL,
  manifest_hash text NOT NULL,
  result bytea,
  result_bytes bigint NOT NULL,
  status text NOT NULL DEFAULT 'prepared',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, sync_id, run_id, batch_id)
);
CREATE TABLE retl.operation (
  workspace_id text NOT NULL, sync_id text NOT NULL, run_id text NOT NULL,
  operation_id text NOT NULL, batch_id text NOT NULL,
  sequence bigint NOT NULL,
  action text NOT NULL CHECK (action IN ('upsert', 'remove')),
  status text NOT NULL DEFAULT 'prepared',
  effects bytea NOT NULL,
  reserved_entries bigint NOT NULL,
  reserved_bytes bigint NOT NULL,
  accepted_at timestamptz,
  PRIMARY KEY (workspace_id, sync_id, run_id, operation_id),
  UNIQUE (workspace_id, sync_id, run_id, sequence),
  FOREIGN KEY (workspace_id, sync_id, run_id, batch_id)
    REFERENCES retl.batch (workspace_id, sync_id, run_id, batch_id)
);
CREATE INDEX batch_retention ON retl.batch (workspace_id,sync_id,created_at,batch_id);
CREATE INDEX operation_pending ON retl.operation (workspace_id, sync_id, run_id, status, sequence);
CREATE TABLE retl.generation (
  workspace_id text NOT NULL, sync_id text NOT NULL, generation text NOT NULL,
  sealed boolean NOT NULL DEFAULT false,
  key_count bigint NOT NULL DEFAULT 0,
  entry_count bigint NOT NULL DEFAULT 0,
  byte_count bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, sync_id, generation)
);
CREATE TABLE retl.source_key (
  workspace_id text NOT NULL, sync_id text NOT NULL, generation text NOT NULL,
  key_hash text NOT NULL,
  PRIMARY KEY (workspace_id, sync_id, generation, key_hash)
);
CREATE TABLE retl.desired (
  workspace_id text NOT NULL, sync_id text NOT NULL, generation text NOT NULL,
  identity_hash text NOT NULL, payload_hash text NOT NULL, value bytea NOT NULL,
  PRIMARY KEY (workspace_id, sync_id, generation, identity_hash)
);
CREATE TABLE retl.association (
  workspace_id text NOT NULL, sync_id text NOT NULL, generation text NOT NULL,
  key_hash text NOT NULL, identity_hash text NOT NULL,
  PRIMARY KEY (workspace_id, sync_id, generation, key_hash, identity_hash)
);
CREATE INDEX association_identity ON retl.association (workspace_id, sync_id, generation, identity_hash);
CREATE TABLE retl.membership (
  workspace_id text NOT NULL, sync_id text NOT NULL,
  identity_hash text NOT NULL, payload_hash text NOT NULL, value bytea NOT NULL,
  PRIMARY KEY (workspace_id, sync_id, identity_hash)
);
CREATE TABLE retl.activation (
  workspace_id text NOT NULL, sync_id text NOT NULL,
  period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, sync_id, period_start)
);
CREATE TABLE retl.outbox (
  id text PRIMARY KEY,
  workspace_id text NOT NULL, sync_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('operation_accepted', 'sync_activated')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz
);
CREATE INDEX outbox_unpublished ON retl.outbox (created_at, id) WHERE published_at IS NULL;
COMMIT;
