# Jitsu Dev Kubernetes Helm Chart

Development Helm chart for deploying Jitsu services to Minikube. Services are built inside containers via init containers - no local build step required.

## Prerequisites

- [Minikube](https://minikube.sigs.k8s.io/docs/start/) installed and running
- [Helm](https://helm.sh/docs/intro/install/) v3+

No host services are required: all dependencies — Kafka (single-node Redpanda),
PostgreSQL, ClickHouse and MongoDB — run in-cluster by default. To use an
external instance of any of them, set the corresponding
`scaling.<dependency>.replicas: 0` and point the matching
`env.common.KAFKA_BOOTSTRAP_SERVERS` / `DATABASE_URL` / `CLICKHOUSE_URL` /
`MONGODB_URL` at it (see `values-custom.example.yaml`).

## Quick Start

```bash
# 1. Start minikube
minikube start

# 2. Deploy (generates secrets and starts the project mount automatically)
./dev-deploy.sh deploy

# 3. Start tunnel for localhost access (in separate terminal)
./dev-deploy.sh tunnel
```

## Configuration

### Secrets

Secrets are generated automatically during `./dev-deploy.sh deploy`: an
`AUTH_TOKEN` for inter-service communication is created with
`openssl rand -hex 16` on first deploy and stored (with its derived keys) in
the `jitsu-secrets` Kubernetes Secret. Subsequent deploys reuse the existing
token.

Connection URLs of the in-cluster dependencies are computed by the chart —
dev credentials are set in `values.yaml` (`postgres.password`,
`clickhouse.password`, `mongodb.password`).

Check secrets status:
```bash
./dev-deploy.sh secrets-status
```

### Custom Configuration (Optional)

Create `values-custom.yaml` for environment-specific overrides:

```yaml
scaling:
  ingest:
    replicas: 2

env:
  common:
    LOG_FORMAT: "json"
```

## Commands

```bash
./dev-deploy.sh <command>
```

| Command | Description |
|---------|-------------|
| `deploy` | Deploy/upgrade Helm chart (auto-starts mount, ensures secrets) |
| `secrets` | (Re)apply auto-generated secrets (also done by `deploy`) |
| `secrets-status` | Show secrets configuration status |
| `mount` | Start minikube mount (project -> /project) |
| `mount-stop` | Stop minikube mount |
| `restart` | Restart all pods (triggers rebuild) |
| `restart <service>` | Restart specific service |
| `status` | Show minikube, mount, pod and service status |
| `watch` | Watch pod status |
| `logs <service>` | Show logs for a service |
| `logs <service> -f` | Follow logs for a service |
| `build-logs <service>` | Show build/init container logs |
| `delete <service>` | Delete pod (forces full recreation) |
| `db-push` | Apply console Prisma schema (runs automatically on fresh install only) |
| `clear-cache [type]` | Clear build caches (go\|node\|all) |
| `tunnel` | Start minikube tunnel (localhost access) |
| `expose` | Show URLs for exposed services |
| `uninstall` | Uninstall the Helm release |

## Services

| Service | Port | Description |
|---------|------|-------------|
| ingest | 3049 | Event ingestion service |
| bulker | 3042 | Batch processing service |
| rotor | 3401 | Event routing service |
| syncctl | 3043 | Sync controller |
| operator | 3052 | Functions server operator |
| kafka | 9092 (in-cluster), 19092 (host via tunnel) | Single-node Redpanda (Kafka API) |
| postgres | 5432 | Single-node PostgreSQL |
| clickhouse | 8123 (HTTP), 9000 (native) | Single-node ClickHouse |
| mongodb | 27017 | Single-node MongoDB |

## Accessing Services

Services are exposed via LoadBalancer. Run tunnel in a separate terminal:

```bash
./dev-deploy.sh tunnel
```

Then access:
- Ingest: http://localhost:3049
- Bulker: http://localhost:3042
- Rotor: http://localhost:3401
- Kafka: localhost:19092 (external listener of the in-cluster Redpanda)
- Postgres: localhost:5432 (`postgres` / `values.yaml postgres.password`)
- ClickHouse: http://localhost:8123 (`default` / `values.yaml clickhouse.password`)
- MongoDB: localhost:27017 (`admin` / `values.yaml mongodb.password`)

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Minikube                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐ │
│  │   console   │ │   ingest    │ │   bulker    │ │   rotor    │ │
│  │ (Node/init) │ │  (Go/init)  │ │  (Go/init)  │ │(Node/init) │ │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └─────┬──────┘ │
│         ├───────────────┼───────────────┼──────────────┤        │
│  ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐ ┌─────┴──────┐ │
│  │    kafka    │ │  postgres   │ │ clickhouse  │ │  mongodb   │ │
│  │ (Redpanda)  │ │    :5432    │ │ :8123/:9000 │ │   :27017   │ │
│  │    :9092    │ │             │ │             │ │            │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘ │
│                                                                  │
│  jitsu-secrets (K8s Secret, AUTH_TOKEN auto-generated on deploy) │
└──────────────────────────────────────────────────────────────────┘
```

## Build Caching

Build artifacts are cached in PersistentVolumeClaims:
- `go-cache` - Go modules and build cache
- `node-cache` - Node modules and build cache

Clear caches if you encounter build issues:

```bash
./dev-deploy.sh clear-cache all
```

## Troubleshooting

### Pods stuck in Init

Check build logs:
```bash
./dev-deploy.sh build-logs <service>
```

### Mount issues

Restart mount:
```bash
./dev-deploy.sh mount-stop
./dev-deploy.sh mount
```

### Services not accessible

Ensure tunnel is running:
```bash
./dev-deploy.sh tunnel
```

### Missing secrets

Secrets are generated automatically by `deploy`. To (re)apply them manually:
```bash
./dev-deploy.sh secrets
```
