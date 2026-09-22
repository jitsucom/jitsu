# Jitsu Dev Kubernetes Helm Chart

Development Helm chart for deploying Jitsu services to Minikube. Services are built inside containers via init containers - no local build step required.

## Prerequisites

- [Minikube](https://minikube.sigs.k8s.io/docs/start/) installed and running
- [Helm](https://helm.sh/docs/intro/install/) v3+

No host services are required: all dependencies — Kafka (single-node Redpanda),
PostgreSQL, ClickHouse and MongoDB — run in-cluster, deployed from the separate
[`../helm-deps`](../helm-deps) chart. `dev-deploy.sh deploy` is staged: it
installs `helm-deps` first and **waits for every dependency to be healthy**
before deploying the Jitsu services, so services never start against missing
dependencies. Dependency connection URLs reach the services through the
`jitsu-deps-urls` Secret published by the deps chart.

To use an external instance of a dependency, set `enabled: false` for it in
`helm-deps/values.yaml` (or a `helm-deps/values-custom.yaml`) and point the
matching `env.common.KAFKA_BOOTSTRAP_SERVERS` / `DATABASE_URL` /
`CLICKHOUSE_URL` / `MONGODB_URL` of this chart at it (see
`values-custom.example.yaml`) — explicit env wins over the published URLs.

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

### Reverse ETL

Disabled by default. Configure `reverseEtl` for the runner image, existing runtime
Secret, dedicated service account/cloud identity, resource limits and SQLite scratch
space. See [Reverse ETL setup and schema cutover](REVERSE_ETL.md) **before deploying**
over an installation with existing Reverse ETL state. The runner image must be
built separately; the chart does not deploy a sidecar or object store.

### Secrets

Secrets are generated automatically during `./dev-deploy.sh deploy`: an
`AUTH_TOKEN` for inter-service communication is created with
`openssl rand -hex 16` on first deploy and stored (with its derived keys) in
the `jitsu-secrets` Kubernetes Secret. Subsequent deploys reuse the existing
token.

Connection URLs of the in-cluster dependencies are published by the
`helm-deps` chart through the `jitsu-deps-urls` Secret — dev credentials are
set in `helm-deps/values.yaml` (`postgres.password`, `clickhouse.password`,
`mongodb.password`).

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
| `db-push` | Apply console Prisma schema on demand (also runs automatically on every deploy) |
| `clear-cache [type]` | Clear build caches (go\|node\|all) |
| `tunnel` | Start minikube tunnel (localhost access) |
| `expose` | Show URLs for exposed services |
| `uninstall` | Uninstall both Helm releases (services and dependencies) |

## Reverse ETL

Reverse ETL is opt-in. Syncctl creates a short-lived Node runner Pod for a manual
run and a CronJob for each scheduled sync; there is no permanent runner Deployment.

Build/load the runner from this checkout (requires local pnpm dependencies and Docker):

```bash
bash helm/build-retl-runner.sh jitsucom/retl-runner:dev
```

Provision a Kubernetes Secret containing `RETL_DATABASE_URL`, `RETL_CONSOLE_URL`,
`RETL_CONSOLE_TOKEN`, `RETL_OBJECT_STORE` (`s3` or `gcs`), and `RETL_OBJECT_BUCKET`.
The bucket must already exist, with credentials or workload identity that let the
runner read/write its artifacts. See [object-storage authentication](REVERSE_ETL.md#cloud-authentication)
for cloud setup and the optional prefix, region, endpoint and AWS credential keys.
Use the restricted database grants from
[`services/retl-runner/README.md`](../services/retl-runner/README.md), the same
database/schema as the console, and the console's `SYNCCTL_AUTH_KEY` as the token.
Keep credentials out of values files and shell history. The console must be
reachable from Pods: the host's `.localhost` URL points at the Pod itself and is
not suitable. For a console running on your host, use its actual listening port,
e.g. `http://host.minikube.internal:4259`, and update it if that port changes.

Set these non-secret values in `helm/values-custom.yaml`:

```yaml
reverseEtl:
  enabled: true
  runnerImage: jitsucom/retl-runner:dev
  runtimeSecret: jitsu-retl-runtime
```

When syncctl uses a host console, set `env.syncctl.REPOSITORY_BASE_URL` to its
`/api/admin/export` URL and `env.syncctl.CONSOLE_URL` to its origin. The optional
`reverseEtl.controllerSecret` can supply controller-only `SYNCCTL_DATABASE_URL`,
`SYNCCTL_RAW_AUTH_TOKENS`, `SYNCCTL_REPOSITORY_AUTH_TOKEN` and `SYNCCTL_CONSOLE_TOKEN`.
These prefixed settings take precedence over the shared unprefixed dev settings.
The local console also needs access to syncctl (for example, a loopback-only
`kubectl --context minikube -n default port-forward --address 127.0.0.1 service/syncctl 3043:3043`).

Before deploying over legacy state, follow the [destructive schema cutover](REVERSE_ETL.md#schema-cutover-and-rollback):
pause/drain workers, back up and resolve pending delivery, and explicitly reset/retire
test syncs and audiences. Normal dev deploys run the Prisma schema hook, so these
steps must happen **before Helm deploy**, not just before controller enablement.
The schema hook must target the same database as the runner. Keep test syncs paused during setup.
Enabling the controller can start scheduled or recovery attempts for enabled syncs.

Use a new image tag after rebuilding so existing CronJobs pick up the change.
The production runner image remains the `retl-runner` target in `all.Dockerfile`.
For a syncctl-only worktree, mount it at a separate Minikube path and set
`syncctlProjectRoot` to that path; other services continue using `projectRoot`.

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

Most development services are exposed via LoadBalancer. Syncctl remains
cluster-internal (`ClusterIP`) because controller authentication is optional.
Run the dev tunnel in a separate terminal. It starts both `minikube tunnel` for
LoadBalancer services and a loopback-only syncctl port-forward:

```bash
./dev-deploy.sh tunnel
```

Then access:
- Ingest: http://localhost:3049
- Bulker: http://localhost:3042
- Rotor: http://localhost:3401
- Kafka: localhost:19092 (external listener of the in-cluster Redpanda)
- Postgres: localhost:5432 (`postgres` / `helm-deps/values.yaml postgres.password`)
- ClickHouse: http://localhost:8123 (`default` / `helm-deps/values.yaml clickhouse.password`)
- MongoDB: localhost:27017 (`admin` / `helm-deps/values.yaml mongodb.password`)
- Syncctl: http://127.0.0.1:3043 (loopback-only port-forward)

The syncctl forward reconnects when its pod restarts. Ctrl+C or exiting the
Minikube tunnel stops both child processes. Port-forward errors (including an
occupied local port) are printed in this terminal and retried every two seconds.

To forward only syncctl, without the other services, run (adjust the namespace if needed):

```bash
kubectl --context minikube -n default port-forward --address 127.0.0.1 service/syncctl 3043:3043
```

Set the local console's `SYNCCTL_URL` to `http://127.0.0.1:3043`. If controller
authentication is configured, also set the matching console `SYNCCTL_AUTH_KEY`.
This does not expose the metrics port or create a public load balancer. Keep the
forward bound to loopback; network exposure requires a separately secured setup
with controller authentication and restricted network access.

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

Two Helm releases in one namespace: `jitsu-deps` (bottom row — deployed
first, waited on for health) and `jitsu` (services). Dependency URLs flow
to the services via the `jitsu-deps-urls` Secret.
```

## Build Caching

Build artifacts are cached in PersistentVolumeClaims:
- `go-cache` - Go modules and build cache
- `node-cache` - Node modules and build cache

These PVCs are created by `dev-deploy.sh deploy` (not by the chart — they must
exist before the pre-install hook runs, and they survive `uninstall`). If you
invoke `helm install` directly instead of using the script, create them first
(see `ensure_cache_pvcs` in `dev-deploy.sh`), otherwise the install job stays
`Pending` on a missing PVC.

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
