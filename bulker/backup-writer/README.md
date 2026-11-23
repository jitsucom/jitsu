# Workspace archive writer

This pilot copies events for one configured workspace alongside the existing Kafka backup. Ingest successes continue to use the existing ingest contract. A 204 from the internal writer means that its SQLite WAL on disk contains the entire request, or the writer previously committed those same bytes for that workspace and key.

## Run the comparison

Build from `bulker/` with `docker build -f backup-writer.Dockerfile -t backup-writer .`. Run one writer behind an internal Service. Mount a retained, writable regional persistent disk at the database path. A replacement writer needs the same disk. Configure the writer as follows.

| Variable | Value |
| --- | --- |
| `BACKUP_WRITER_DB` | Absolute database file on the mounted volume, such as `/data/archive.db` |
| `BACKUP_WRITER_BUCKET_PREFIX` | Dedicated shadow bucket prefix. The complete bucket name is this prefix followed by the workspace ID. |
| `BACKUP_WRITER_TOKEN` | Secret shared with ingest for bearer authentication |
| `BACKUP_WRITER_ADDR` | Listen address, defaults to `:8080` |

Provision the comparison bucket separately with the workspace retention policy. Scope the writer identity to object creation and metadata reads in that bucket. Keep shadow data outside the production archive and its replay listings. The writer uses Application Default Credentials. Restrict network access to ingest.

Set `INGEST_BACKUP_SHADOW_WORKSPACE` to the selected GCS workspace ID, `INGEST_BACKUP_SHADOW_URL` to the writer's base URL and `INGEST_BACKUP_SHADOW_TOKEN` to the shared secret. The default is off. The copy runs for backup-enabled streams at the existing backup decision point. Eight in-flight copies per ingest pod bound the effect on ingest. Compare event IDs and the `accepted`, `busy` and `failed` results of `ingest_backup_shadow_events_total` when interpreting coverage.

## Admission and recovery

`POST /v1/archive/{workspace}` accepts up to 8 MiB of newline-delimited ingest envelopes from one workspace. Send a bearer token and an `Idempotency-Key` unique to the submission. Retry an ambiguous response with the same key and bytes. Reusing a key for different bytes returns 409. The writer keeps admission receipts while pending and for at least 24 hours after upload. Client resubmissions with new keys have at-least-once semantics.

Every 30 seconds the writer groups pending records into per-workspace gzip NDJSON objects. It persists the immutable object name and membership before sending bytes to GCS. A retry uses create-only generation preconditions and checks object size, CRC32C and the uncompressed SHA-256 before accepting an existing object. A failed upload stays pending. The writer stops admitting new requests below 256 MiB of filesystem headroom and can still acknowledge matching retries. Disk space freed in SQLite is reused for later writes. If another process exhausts the volume, restore free space or grow the volume so SQLite can checkpoint.

Before authoritative cutover, measure admission latency, exercise regional disk reattachment and verify a real archive through the reprocessing worker. The pilot's bounded shadow copies can be dropped. Authoritative integration must wait for durable admission on every applicable ingest route and define retry behavior for partially processed client batches.
