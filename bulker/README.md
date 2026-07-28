# 🚚 Bulker

Bulker streams and batches large amounts of semi-structured data into data warehouses. Send it JSON,
and it takes care of getting that JSON into a table — creating the table, adding columns, picking
types, retrying on failure, and choosing the write strategy the destination is happiest with.

Bulker is the ingestion engine behind [Jitsu](../README.md), and lives in the same repository. You
can use it three ways:

- **As part of Jitsu** — it's what writes your events to the warehouse. Nothing to set up.
- **As a standalone HTTP service** — `POST` JSON to an endpoint, it lands in your warehouse. See
  [Server Configuration](./.docs/server-config.md) and [HTTP API](./.docs/http-api.md).
- **As a Go library** — embed it in your own application, no server involved.

## How it works

<p align="center">
<img src="./.docs/assets/bulker-summary.excalidraw.png" width="600" />
</p>

Send a JSON object to Bulker, and it will make sure the object is saved to the data warehouse:

- **JSON flattening.** Your object is flattened — `{a: {b: 1}}` becomes `{a_b: 1}`.
- **Schema management for semi-structured data.** For each field, Bulker makes sure a corresponding
  column exists in the destination table, and creates it if not. The type is best-guessed from the
  value, or set explicitly with a type hint: `{"a": "test", "__sql_type_a": "varchar(4)"}`.
- **Reliability.** The object goes to a Kafka queue immediately, so if the warehouse is down, data
  isn't lost.
- **Streaming or batching.** Data goes to the warehouse either as soon as it's available in Kafka
  (streaming) or after an interval (batching). Most warehouses won't tolerate a large number of
  individual inserts, which is why batching exists.

## Features

- 🛢️ **Batching** — Bulker sends data in the most efficient way for the particular database. For
  Postgres it uses `COPY`, for BigQuery batch files, and so on.
- 🚿 **Streaming** — alternatively, Bulker streams data row by row. Useful when volume is low: up to
  roughly 10 records per second for most databases.
- 🐫 **Deduplication** — if configured, Bulker deduplicates records by primary key.
- 📋 **Schema management** — tables and columns are created on the fly, and nested JSON is
  flattened. Send `{"a": {"b": 1}}` and Bulker ensures a column `a_b` exists.
- 🦾 **Implicit typing** — column types are inferred from the JSON data.
- 📌 **Explicit typing** — override inference with type hints placed in the JSON. For
  `{"a": "test", "__sql_type_a": "varchar(4)"}` Bulker ensures column `a` is `varchar(4)`.
- 📈 **Horizontal scaling** — instances are stateless; add more of them.
- 📦 **Dockerized** — deployable to any cloud provider or Kubernetes.
- ☁️ **Cloud native** — each instance is configured by a handful of environment variables.

## Supported destinations

| Destination                | Type            |
| -------------------------- | --------------- |
| PostgreSQL                 | SQL             |
| ClickHouse                 | SQL             |
| Snowflake                  | SQL             |
| BigQuery                   | SQL             |
| Redshift                   | SQL             |
| MySQL                      | SQL             |
| DuckDB                     | SQL             |
| S3                         | File storage    |
| Google Cloud Storage       | File storage    |
| Webhook                    | API             |
| Mixpanel                   | API             |

See the [compatibility matrix](.docs/db-feature-matrix.md) for which Bulker features each
destination supports.

## What's in this directory

Bulker is a set of Go modules tied together by a Go workspace. The services:

| Module                                             | Docker image        | What it does                                                                    |
| -------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| [`bulkerapp/`](./bulkerapp)                        | `jitsucom/bulker`   | The Bulker server — consumes Kafka topics and writes batches to destinations     |
| [`ingest/`](./ingest)                              | `jitsucom/ingest`   | Jitsu's public ingestion API — accepts events over HTTP and writes them to Kafka |
| [`sync-controller/`](./sync-controller/README.md)  | `jitsucom/syncctl`  | Runs connector sync tasks as Kubernetes pods and tracks their status             |
| [`sync-sidecar/`](./sync-sidecar/README.md)        | `jitsucom/sidecar`  | Sidecar to an Airbyte-protocol connector — captures rows, logs and state         |
| [`ingress-manager/`](./ingress-manager)            | —                   | Manages Kubernetes ingress and TLS certificates for customer custom domains      |
| [`admin/`](./admin)                                | —                   | Admin service — orchestrates failover and dead-letter reprocessing jobs          |
| [`reprocessing-worker/`](./reprocessing-worker/README.md) | —            | Worker that runs in K8s Job pods to reprocess failover files in parallel         |
| [`config-keeper/`](./config-keeper)                | —                   | Caches configuration repositories and serves them to the other services          |
| [`operator/`](./operator)                          | —                   | Kubernetes operator that provisions functions-server deployments per workspace   |

And the libraries:

| Module                                | What it is                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| [`bulkerlib/`](./bulkerlib)           | The core library — bulk modes, schema management, and every destination adapter   |
| [`jitsubase/`](./jitsubase)           | Shared utilities: app bootstrap, logging, types, safe-go helpers                  |
| [`kafkabase/`](./kafkabase)           | Kafka producer/consumer plumbing shared by the services                           |
| [`eventslog/`](./eventslog)           | Event log writers (ClickHouse, Redis) behind Jitsu's Live Events                  |
| [`connectors/`](./connectors)         | Connector SDKs — Airbyte CDK bindings and the native Firebase connector           |

## Documentation

> **Note:** we recommend reading [Core Concepts](#core-concepts) below before diving into details.

- [Server configuration](./.docs/server-config.md) — every environment variable Bulker server reads
- [HTTP API](./.docs/http-api.md) — endpoints, auth, request format
- [Database feature matrix](./.docs/db-feature-matrix.md) — per-destination feature support
- [Jitsu documentation](https://jitsu.com/docs) — the platform Bulker powers

## Core concepts

### Destinations

Bulker operates with destinations. A destination is a database or storage service (e.g. S3, GCS).
Each destination has an ID and a configuration represented by a JSON object. The HTTP API loads data
into destinations by referencing those IDs. If the destination is a database, you also provide a
table name.

### Event

The main unit of data in Bulker is an *event* — a JSON object.

### Batching and streaming (aka destination mode)

Bulker can send data to a database in two ways:

- **Streaming** — events go to the destination one by one. Useful when volume is low (under ~10
  events per second for most databases).
- **Batching** — events accumulate and are sent periodically, once the batch is full or a timeout is
  reached. More efficient for large volumes, especially for cloud data warehouses.

<p align="center">
<img src="./.docs/assets/stream-batch.excalidraw.png" width="600" />
</p>

### Primary keys and deduplication

Optionally, Bulker deduplicates events by primary key — useful when the same event can be sent more
than once. Where primary keys are available Bulker uses them; for some warehouses alternative
strategies apply.

> [Read more about deduplication »](./.docs/db-feature-matrix.md)

## Development

Requires Go 1.26. The modules are wired together by a Go workspace (`go.work`, see
[GOWORK.md](./GOWORK.md) if you need to recreate it):

```bash
go build ./...
go test ./...
```

Destination tests spin up real databases via testcontainers, so Docker needs to be running. Release
and packaging details are in [CONTRIBUTING.md](./CONTRIBUTING.md); repository-wide conventions are in
the [root CONTRIBUTING.md](../CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
