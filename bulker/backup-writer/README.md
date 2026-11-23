# Workspace archive writer

This pilot copies events for one configured workspace alongside the existing Kafka backup. Ingest successes continue to use the existing ingest contract. A 204 from the internal writer means that the entire request has been appended to a workspace segment and synced to disk. Repeating a submission writes another copy.

## Run the comparison

Build from `bulker/` with `docker build -f backup-writer.Dockerfile -t backup-writer .`. Run one writer behind an internal Service. Mount a retained, writable regional persistent disk at the spool path. A replacement writer needs the same disk. Configure the writer as follows.

| Variable | Value |
| --- | --- |
| `BACKUP_WRITER_SPOOL_DIR` | Existing dedicated directory on the mounted volume, such as `/data/archive`. Start with an empty directory writable by UID 65532 |
| `BACKUP_WRITER_BUCKET_PREFIX` | Dedicated shadow bucket prefix. The complete bucket name is this prefix followed by the workspace ID. |
| `BACKUP_WRITER_TOKEN` | Secret shared with ingest for bearer authentication |
| `BACKUP_WRITER_ADDR` | Listen address, defaults to `:8080` |

Provision the comparison bucket separately with the workspace retention policy. Scope the writer identity to object creation and metadata reads in that bucket. Keep shadow data outside the production archive and its replay listings. The writer uses Application Default Credentials. Restrict network access to ingest.

Set `INGEST_BACKUP_SHADOW_WORKSPACE` to the selected GCS workspace ID, `INGEST_BACKUP_SHADOW_URL` to the writer's base URL and `INGEST_BACKUP_SHADOW_TOKEN` to the shared secret. The default is off. The copy runs for backup-enabled streams at the existing backup decision point. Eight in-flight copies per ingest pod bound the effect on ingest. Compare event IDs and the `accepted`, `busy` and `failed` results of `ingest_backup_shadow_events_total` when interpreting coverage.

## Admission and recovery

`POST /v1/archive/{workspace}` accepts up to 8 MiB of newline-delimited ingest envelopes from one workspace. Send a bearer token. The writer validates the entire request, appends a length and checksum followed by the original NDJSON, then syncs the file. It also syncs the directory when creating a segment. A timeout after persistence can produce duplicate events on retry.

The writer rotates segments at 8 MiB or on its 30-second upload cycle. Every restart opens fresh files for new requests. Recovery reads completed frames from the old files, drops a torn final request, and checks both frame lengths and payload checksums. If it detects corruption, it uploads the verified prefix under a distinct object name and keeps the full segment on disk with a `.damaged` suffix for investigation. Each filename fixes its GCS object key. The writer removes the local segment after creating the object or verifying that an earlier upload already stored matching content. Admission reserves 256 MiB of disk headroom. Uploads and cleanup continue when new writes are refused.

Before authoritative cutover, measure admission latency, exercise regional disk reattachment and verify a real archive through the reprocessing worker. The pilot's bounded shadow copies can be dropped. Authoritative integration must wait for durable admission on every applicable ingest route and define retry behavior for partially processed client batches.
