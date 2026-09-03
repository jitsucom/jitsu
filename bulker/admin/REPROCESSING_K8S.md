# Kubernetes Indexed Jobs for Failover Reprocessing

This document describes the Kubernetes-based reprocessing implementation for distributed failover log processing.

## Overview

The failover reprocessor uses Kubernetes Indexed Jobs for distributed processing with PostgreSQL for status tracking. This provides:

- **Horizontal scaling**: Multiple worker pods process files in parallel
- **Persistent status**: Job and worker status stored in PostgreSQL database
- **Resilience**: Workers can be restarted, and progress is tracked
- **Centralized monitoring**: Admin service aggregates status from all workers

## Architecture

### Components

1. **Admin Service** (`admin/`)
   - Creates Kubernetes Indexed Jobs
   - Prepares file list with sizes
   - Creates ConfigMaps with file assignments
   - Tracks job status via PostgreSQL
   - Provides REST API for job management

2. **Worker Pods** (`reprocessing-worker/main.go`)
   - Run as Kubernetes Job pods with completion index
   - Each worker processes its assigned subset of files
   - Updates status in PostgreSQL periodically
   - Sends processed events to Kafka
   - Reads infrastructure credentials from mounted secret

3. **Database Tables**
   - `reprocessing_jobs`: Main job records
   - `reprocessing_workers`: Per-worker status and metrics

### How It Works

1. **Job Creation**: Admin service receives reprocessing request via API
2. **File Discovery**: Lists all files from S3, GCS, or a local path and gets file sizes
3. **Worker Distribution**: Calculates optimal worker count (1 worker per 10 files, max 50)
4. **ConfigMap Creation**: Creates two ConfigMaps:
   - File list with sizes
   - Job configuration (stream_ids, date ranges, etc.)
5. **Secret Creation**: Creates Secret with infrastructure credentials:
   - DATABASE_URL
   - KAFKA_BOOTSTRAP_SERVERS, KAFKA_DESTINATIONS_TOPIC
   - REPOSITORY_URL, REPOSITORY_AUTH_TOKEN
   - AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION (if available in admin environment)
6. **Job Launch**: Creates Kubernetes Indexed Job with N completions
7. **Worker Processing**: Each pod (indexed 0 to N-1) selects its files using modulo distribution
8. **Credential Loading**: Workers read all credentials from environment variables (mounted from Secret using envFrom)
9. **Repository Initialization**: Workers fetch stream metadata from repository once at startup (no periodic refresh needed for short-lived workers)
10. **Message Processing**: For each message, connection ids are resolved in this order:
   - Events of streams not selected by `stream_ids` are skipped (see [Selecting streams and connections](#selecting-streams-and-connections))
   - If `stream_ids` is a map, the entry for this stream (exact id/slug, else the `*` entry) decides its connections:
     - override mode (default): use the listed connections instead of the mapped ones
     - filter mode (`connections_filter: true`): keep the stream's mapped connections, minus those not listed
     - a connection id of `*` means the mapped connections in either mode
     - a rule that resolves to no connections drops the event (counted as skipped)
   - Otherwise, look up stream destinations from repository using `origin.source_id` or `origin.slug`
   - Send message to Kafka with appropriate connection_ids header
11. **Status Updates**: Workers update PostgreSQL with progress every 1000 lines
12. **Status Aggregation**: Admin API aggregates stats from all workers

## Configuration

### Environment Variables

Required configuration for the admin service:

```bash
# Database for status tracking (REQUIRED)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Kubernetes configuration (REQUIRED)
K8S_CONFIG_PATH=local  # or path to kubeconfig file
K8S_NAMESPACE=default
K8S_MAX_PARALLEL_WORKERS=10  # Default max workers running simultaneously (per-job `parallel_workers` overrides it)
KUBERNETES_NODE_SELECTOR='{"disktype": "ssd"}'  # Optional: node selector in JSON format
REPROCESSING_WORKER_IMAGE=jitsucom/bulker-reprocessing-worker:latest

# Infrastructure credentials (passed to worker pods via Secret)
KAFKA_BOOTSTRAP_SERVERS=...
KAFKA_DESTINATIONS_TOPIC=bulker-destinations
REPOSITORY_URL=...
REPOSITORY_AUTH_TOKEN=...

# AWS credentials (optional, passed to worker pods if available)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-1
```

GCS access uses [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials).
On GKE, grant the admin and worker pod identities access to the bucket through
Workload Identity. The admin needs object-list permission and workers need
object-read permission.

**Note**: Both `DATABASE_URL` and Kubernetes access are required. The reprocessing manager will not initialize without them.

## Database Schema

The schema is automatically created on startup:

```sql
-- Main jobs table
CREATE TABLE reprocessing_jobs (
    id VARCHAR(64) PRIMARY KEY,
    config JSONB NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    k8s_job_name VARCHAR(255),
    total_files INTEGER DEFAULT 0,
    total_workers INTEGER DEFAULT 0,
    error TEXT
);

-- Worker status table
CREATE TABLE reprocessing_workers (
    job_id VARCHAR(64) NOT NULL,
    worker_index INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    current_file TEXT,
    current_line BIGINT DEFAULT 0,
    current_timestamp TEXT,
    assigned_files INTEGER DEFAULT 0,
    processed_files INTEGER DEFAULT 0,
    total_lines BIGINT DEFAULT 0,
    success_count BIGINT DEFAULT 0,
    error_count BIGINT DEFAULT 0,
    skipped_count BIGINT DEFAULT 0,
    total_bytes BIGINT DEFAULT 0,
    processed_bytes BIGINT DEFAULT 0,
    error TEXT,
    PRIMARY KEY (job_id, worker_index),
    FOREIGN KEY (job_id) REFERENCES reprocessing_jobs(id) ON DELETE CASCADE
);
```

## API Endpoints

All existing endpoints continue to work, with additional data:

### Start Job
```bash
POST /api/admin/reprocessing/jobs
Content-Type: application/json
Authorization: Bearer <token>

{
  "gcs_path": "gs://bucket/failover/",
  "stream_ids": ["stream1", "stream2"],
  "events": ["page", "signup"],
  "date_from": "2024-01-01T00:00:00Z",
  "date_to": "2024-01-31T23:59:59Z",
  "parallel_workers": 20
}
```

Exactly one of `s3_path`, `gcs_path`, or `local_path` is required. GCS paths
use the `gs://bucket/prefix` form. The optional `events` array is an exact
allowlist matched against the event's `type` and, when `type` is `track`, its
`event` name. For example, `"track"` accepts every track event while
`"signup"` accepts track events named `signup`.

### Selecting streams and connections

In the admin UI the **Stream IDs** field accepts all three of these — plain text
is split on newlines, a leading `[` or `{` is parsed as JSON:

```
stream1
stream2
```
```json
["stream1", "stream2"]
{"stream1": ["connection1"], "stream2": "connection2", "*": "*"}
```

Over the API, `stream_ids` takes either shape:

```json
"stream_ids": ["stream1", "stream2"]
```

Reprocess these streams (matched by stream id or slug) to the connections mapped
to them in the repository. Omit the field to reprocess every stream.

```json
"stream_ids": {"stream1": ["connection1", "connection2"], "stream2": "connection3"}
```

Reprocess these streams, routing each one's events to the listed connections. A
single connection id may be given instead of a list.

Two wildcards are available:

| Wildcard | Meaning |
| --- | --- |
| `*` as a **key** | Applies to every stream — selects them all and gives them a default rule. A stream's own entry wins over it |
| `*` as a **connection id** | The stream's repository-mapped connections, in either mode |

So `{"stream1": ["*", "connection1"]}` sends stream1 everywhere it normally goes
*plus* connection1, and `{"*": "*"}` reprocesses every stream to its mapped
connections — the same as omitting the field.

`connections_filter` picks what the listed connections mean:

| Mode | Effect |
| --- | --- |
| override (default) | Send to exactly the listed connections, ignoring what the stream is mapped to |
| filter (`connections_filter: true`) | Send to the stream's mapped connections, minus those not listed |

`*` as a connection id is not affected by the mode: in override mode it expands
to the mapped connections (unioned with any explicitly listed ones), and in
filter mode it lets every mapped connection through.

In both modes only selected streams are reprocessed, and a rule that resolves to
no connections drops the event (counted as skipped) rather than falling back to
the mapped connections — so `{"stream1": []}` means "reprocess nothing for
stream1", not "send everywhere". By the same rule an explicitly empty selector
(`[]` or `{}`) selects no streams at all; omit the field to reprocess every
stream.

Examples:

```json
{"stream_ids": {"*": "connection1"}}                        // every stream, everything to connection1
{"stream_ids": {"*": "connection1"}, "connections_filter": true}  // every stream, but only its mapping to connection1
{"stream_ids": {"stream1": "connection1"}}                  // only stream1, routed to connection1
{"stream_ids": {"stream1": ["*", "connection1"]}}           // only stream1, to its mapped connections plus connection1
{"stream_ids": {"stream1": "*"}}                            // only stream1, to its mapped connections
```

`parallel_workers` caps how many worker pods run at once for this job. When
omitted, the `K8S_MAX_PARALLEL_WORKERS` server setting applies. Either way the
total worker count still follows the number of files.

Response includes `total_workers` and `k8s_job_name`.

The admin UI's **Use as Template** button on any past job fills the start-job
form with that job's settings, so a run can be repeated or adjusted without
re-entering every field.

### Get Job Status
```bash
GET /api/admin/reprocessing/jobs/{id}
Authorization: Bearer <token>
```

Returns aggregated statistics from all workers.

### Get Worker Details (NEW)
```bash
GET /api/admin/reprocessing/jobs/{id}/workers
Authorization: Bearer <token>
```

Returns array of worker statuses:
```json
{
  "workers": [
    {
      "worker_index": 0,
      "status": "running",
      "assigned_files": 15,
      "processed_files": 10,
      "total_lines": 50000,
      "success_count": 49500,
      "error_count": 500,
      "skipped_count": 0,
      "processed_bytes": 10485760,
      "current_file": "s3://bucket/file_10.ndjson.gz",
      "current_line": 5000,
      "updated_at": "2024-01-15T10:30:45Z"
    }
  ]
}
```

### Cancel Job
```bash
POST /api/admin/reprocessing/jobs/{id}/cancel
Authorization: Bearer <token>
```

Deletes the Kubernetes Job, which stops all worker pods.

### View Job Logs (NEW)
```bash
GET /api/admin/reprocessing/jobs/{id}/logs?tail=50&since=10&sort=true
Authorization: Bearer <token>
```

Returns logs from all worker pods:

**Per-Worker Format** (default, `sort=false`):
```json
{
  "job_id": "job-123",
  "sorted": false,
  "logs": [
    {
      "worker_index": 0,
      "pod_name": "reprocess-job-123-0-abc123",
      "lines": ["2024-01-15T10:30:45.123456789Z log line 1", ...],
      "error": "optional error message if logs unavailable"
    }
  ]
}
```

**Chronological Format** (`sort=true`):
```json
{
  "job_id": "job-123",
  "sorted": true,
  "lines": [
    {
      "timestamp": "2024-01-15T10:30:45.123456789Z",
      "worker_index": 0,
      "pod_name": "reprocess-job-123-0-abc123",
      "message": "log message"
    }
  ]
}
```

Parameters:
- `tail=50` - Get last N lines (default: 50, used on initial load)
- `since=10` - Get logs from last N seconds (used for incremental updates)
- `sort=true` - Return logs sorted chronologically across all workers (default: false)

**Note**: Kubernetes automatically adds RFC3339 timestamps to log lines even if the application doesn't log them, enabling chronological sorting across workers.

### View Logs UI (NEW)
```bash
GET /api/admin/reprocessing/jobs/{id}/logs/view?token=<token>
```

Opens an HTML page with real-time log viewer. The authentication token is passed via URL parameter and used for subsequent API calls to fetch logs.
- **Two view modes**: Per-worker (default) or Chronological (sorted by time)
- Toggle between views with "Switch to Chronological" button
- Shows logs from all worker pods
- Auto-refreshes every 5 seconds
- Color-coded log levels (error, warning, info)
- Deduplicates lines automatically using Set/hash-based tracking
- Auto-scrolls to bottom
- Can pause/resume auto-refresh
- Timestamps added by Kubernetes for chronological sorting
- Worker badge [W0], [W1] shown in chronological view
- Opens in popup window from admin UI

## Building and Deploying

### Build Worker Image

```bash
./reprocessing-worker-build.sh
```

This builds and pushes `jitsucom/bulker-reprocessing-worker:latest`

### Deploy Admin Service

Ensure the admin service has:
1. PostgreSQL database access
2. Kubernetes access (via in-cluster config or kubeconfig)
3. S3 access (via AWS credentials), when processing S3 files
4. GCS access (via Application Default Credentials), when processing GCS files
5. Kafka access

**Note**: The admin service automatically provisions infrastructure credentials (database_url, kafka_bootstrap_servers, kafka_destinations_topic, repository_url, repository_auth_token) to worker pods via Kubernetes Secrets. Worker pods do not need these as environment variables - they read them from the mounted secret at `/config/job/`.

### Kubernetes Permissions

The admin service needs these RBAC permissions:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: bulker-admin
rules:
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["create", "get", "list", "delete"]
- apiGroups: [""]
  resources: ["configmaps", "secrets"]
  verbs: ["create", "get", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: bulker-admin
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: bulker-admin
subjects:
- kind: ServiceAccount
  name: bulker-admin
```

## Kubernetes Resources Created

For each reprocessing job, the admin service creates:

### ConfigMap: `reprocess-{job-id}-files`
Contains the complete list of files to process:
- `files.json`: Array of file paths and sizes
- `worker_count`: Number of workers
- `total_files`: Total number of files

### Secret: `reprocess-{job-id}-config`
Contains job configuration and infrastructure credentials:
- `config.json`: Job configuration (stream_ids, date ranges, etc.)
- `database_url`: PostgreSQL connection string for status tracking
- `kafka_bootstrap_servers`: Kafka broker addresses for sending processed messages
- `kafka_destinations_topic`: Kafka topic name for reprocessed events
- `repository_url`: Repository service URL for looking up stream metadata
- `repository_auth_token`: Repository authentication token

**Purpose of Repository**: Unless `stream_ids` supplies connections in override mode, workers look up the stream's asynchronous destinations from the repository based on the message's `origin.source_id` or `origin.slug` (filter mode needs the mapping too, to subtract from it). Workers fetch stream metadata once at startup and cache it in memory for the duration of processing (no periodic refresh needed since workers are short-lived).

**Security**: The secret is automatically deleted when the job is cancelled or cleaned up after 24 hours.

### Indexed Job: `reprocess-{job-id}`
Kubernetes batch job with:
- Completion mode: `Indexed`
- Completions: Number of workers
- Parallelism: Min(completions, job `parallel_workers` or K8S_MAX_PARALLEL_WORKERS)
- TTL after finished: 24 hours

## File Distribution

Files are distributed to workers using round-robin (modulo) distribution:
- Worker 0 gets files: 0, N, 2N, 3N...
- Worker 1 gets files: 1, N+1, 2N+1, 3N+1...
- Worker i gets files: i, N+i, 2N+i, 3N+i...

This ensures even distribution when file sizes vary.

## Monitoring

### Job Progress

Check overall job progress:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://admin:3049/api/admin/reprocessing/jobs/$JOB_ID
```

### Worker Details

See individual worker status:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://admin:3049/api/admin/reprocessing/jobs/$JOB_ID/workers
```

### View Worker Logs

View real-time logs from all workers:
```bash
# Via UI (recommended)
Open http://admin:3049/ in browser, click "View Logs" button for any job

# Via API
curl -H "Authorization: Bearer $TOKEN" \
  http://admin:3049/api/admin/reprocessing/jobs/$JOB_ID/logs
```

The logs viewer UI provides:
- **Two view modes**:
  - **Per-Worker View**: Shows logs grouped by worker pod (default)
  - **Chronological View**: All logs sorted by timestamp across all workers
- Toggle between views with one click
- Real-time log streaming with 5-second refresh
- Kubernetes-provided timestamps for accurate chronological ordering
- Worker badges [W0], [W1], etc. in chronological view
- Color-coded log levels (errors in red, warnings in yellow, info in blue)
- Auto-deduplication to prevent showing duplicate lines
- Pause/resume functionality
- Auto-scroll to latest logs

### Kubernetes Job Status

```bash
kubectl get jobs -l job-id=$JOB_ID
kubectl get pods -l job-id=$JOB_ID
```

### Database Queries

```sql
-- Job overview
SELECT * FROM reprocessing_jobs WHERE id = 'job-id';

-- Worker details
SELECT * FROM reprocessing_workers WHERE job_id = 'job-id' ORDER BY worker_index;

-- Aggregated progress
SELECT
  job_id,
  COUNT(*) as total_workers,
  SUM(processed_files) as total_processed_files,
  SUM(success_count) as total_success,
  SUM(error_count) as total_errors
FROM reprocessing_workers
WHERE job_id = 'job-id'
GROUP BY job_id;
```

## Database Migration

If you have existing reprocessing jobs in the database from before this version, their `k8s_job_name` field may be NULL. To fix this for running jobs, you can manually update the database:

```sql
-- For jobs created before the k8s_job_name fix
-- The k8s job name follows the pattern: reprocess-{job_id}
UPDATE reprocessing_jobs
SET k8s_job_name = 'reprocess-' || id
WHERE k8s_job_name IS NULL AND status IN ('pending', 'running');
```

Alternatively, you can simply cancel old jobs and create new ones.

## Troubleshooting

### Workers Failing

Check worker logs:
```bash
kubectl logs <pod-name>
```

Common issues:
- **Repository fetch failure**: Worker exits if it can't fetch stream metadata at startup
  - Check repository URL is accessible from worker pods
  - Verify repository_auth_token is correct
  - Check network policies allow worker pods to reach repository service
  - Verify repository service returns valid JSON array of streams
- **S3 credentials**: Not available in worker pods (check IAM roles or environment variables)
- **GCS credentials**: The admin or worker identity lacks bucket access (check Application Default Credentials / GKE Workload Identity)
- **Database connection**: Worker can't connect to PostgreSQL
- **Kafka connection**: Worker can't connect to Kafka brokers

### Job Not Starting

Check admin service logs for Job creation errors:
- ConfigMap/Secret creation failures
- RBAC permission issues
- Invalid job configuration

### Slow Processing

- Set `parallel_workers` on the job (or increase `K8S_MAX_PARALLEL_WORKERS` for the default) for more parallelism
- Check if S3 download is bottleneck
- Check Kafka producer throughput
- Adjust `batch_size` in job config

## Performance

Expected throughput per worker:
- ~10,000-50,000 events/second (depending on event size and Kafka config)
- ~100 MB/second S3 download
- Recommended: 1 worker per 10 files or 1GB of data

With 10 parallel workers, can process:
- ~100,000-500,000 events/second
- ~10-50 GB of compressed data per minute
