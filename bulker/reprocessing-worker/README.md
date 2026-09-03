# Reprocessing Worker

This is the worker binary that runs in Kubernetes Job pods for distributed failover reprocessing.

## Overview

The reprocessing worker is part of the Kubernetes-based reprocessing system. It runs as pods in an Indexed Job, where each pod processes a subset of failover files in parallel.

## How It Works

1. **Started by K8s Job**: The admin service creates a Kubernetes Indexed Job with N completions
2. **Loads Configuration**: Worker reads job config from mounted Secret and file list from ConfigMap
3. **Selects Files**: Uses its completion index to select files via modulo distribution (index % total_workers)
4. **Processes Files**: Reads files from S3, GCS, or the local filesystem, parses NDJSON, and applies filters
5. **Sends to Kafka**: Batches events and sends to Kafka destinations topic
6. **Updates Status**: Writes progress to PostgreSQL every 1000 lines

## Environment Variables

Required environment variables (set by K8s Job):

- `JOB_ID` - Unique job identifier
- `WORKER_INDEX` - Pod's completion index (0 to N-1)
- `DATABASE_URL` - PostgreSQL connection string
- `KAFKA_BOOTSTRAP_SERVERS` - Kafka brokers
- `KAFKA_DESTINATIONS_TOPIC` - Kafka topic for output (default: bulker-destinations)

## Mounted Volumes

- `/config/files/files.json` - ConfigMap with list of files to process
- `/config/job/config.json` - Secret with job configuration

## File Distribution

Workers use modulo distribution:
- Worker 0 processes files: 0, N, 2N, 3N...
- Worker 1 processes files: 1, N+1, 2N+1, 3N+1...
- Worker i processes files: i, N+i, 2N+i, 3N+i...

This ensures even distribution across workers.

## Status Tracking

The worker updates the `reprocessing_workers` table in PostgreSQL with:
- Current file being processed
- Line number within file
- Total lines processed
- Success/error/skipped counts
- Bytes processed
- Status (running/completed/failed)

Updates occur:
- On start (status: running)
- Every 1000 lines during processing
- After each file completes
- On completion (status: completed)
- On error (status: failed)

## Building

Build the Docker image:

```bash
./reprocessing-worker-build.sh
```

This builds and pushes `jitsucom/bulker-reprocessing-worker:latest`

## Local Testing

You can test the worker locally by setting environment variables and mounting config files:

```bash
export JOB_ID=test-job-123
export WORKER_INDEX=0
export DATABASE_URL=postgresql://localhost/bulker
export KAFKA_BOOTSTRAP_SERVERS=localhost:9092

# Create config files
mkdir -p /tmp/config/files /tmp/config/job
echo '[{"path":"s3://bucket/file.ndjson","size":1024}]' > /tmp/config/files/files.json
echo '{"batch_size":100}' > /tmp/config/job/config.json

# Mount and run
go run main.go
```

## Dependencies

- `jitsubase` - Base utilities (JSON, UUID, etc.)
- `kafkabase` - Kafka producer wrapper
- PostgreSQL via pgx
- AWS SDK for S3 access
- Google Cloud Storage SDK using Application Default Credentials (including GKE Workload Identity)
- Confluent Kafka client

## Error Handling

- Parse errors: Logged and counted in error_count, processing continues
- Kafka errors: Batch marked as failed, processing continues
- File access errors: File marked as failed, processing continues to next file
- Fatal errors (DB, Kafka init): Worker exits with error status
