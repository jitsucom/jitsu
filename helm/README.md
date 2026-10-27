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

## Mac-hosted console over local HTTPS

For a portless console, use its single-prefix `https://console-<branch>.jitsu.localhost`
origin with these settings in `env.syncctl`:

- `CONSOLE_URL`: `https://console-<branch>.jitsu.localhost`
- `REPOSITORY_BASE_URL`: `https://console-<branch>.jitsu.localhost/api/admin/export`
- `REPOSITORY_URL`: `https://console-<branch>.jitsu.localhost/api/admin/export/streams-with-destinations`

Set `RETL_CONSOLE_URL` in the existing Reverse ETL runtime Secret to the same origin
as `CONSOLE_URL`. This avoids depending on the console's changing development port.

Pods need two additional pieces of local configuration:

- Add that exact hostname to Minikube CoreDNS's existing `hosts` block, using
  the IP already assigned there to `host.minikube.internal`. This is the Mac's
  gateway address, **not** the Minikube node IP. The mapping must be refreshed
  if the gateway changes; it is local cluster configuration, not chart-owned.
- Create a ConfigMap with key `ca.crt` from portless's public `ca.pem` (never
  copy `ca-key.pem`), then set `syncctlExtraCAConfigMap` to its name. For example:
  `kubectl --context minikube -n default create configmap jitsu-portless-ca --from-file=ca.crt=/Users/<user>/.portless/ca.pem`.

The chart mounts this CA into syncctl; syncctl also mounts it into all newly
created Reverse ETL runner pods. TLS verification remains enabled. This optional
CA extends runner-wide trust, so use only a CA you control. Restart syncctl and
start new runner pods after rotating the certificate. Ordinary syncs' admission
containers also receive the CA to reach the same console; source connectors do
not. Leave it empty in environments using publicly trusted HTTPS.

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
For Google Ads API streams, optionally add `GOOGLE_ADS_DEVELOPER_TOKEN`; for Microsoft
Ads, add `MICROSOFT_ADS_DEVELOPER_TOKEN` to this runtime Secret as the fallback when
a destination has no developer token. Both keys are passed to newly created runner pods. A
controller/console token is not automatically inherited by runner pods.
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

### Functions-server request authentication

Before running the signed-request functions-server release, provision an Ed25519 key pair
(PKCS#8 PEM private key, SPKI PEM public key). Keep the private key in the existing
`jitsu-secrets` Kubernetes Secret, not in Helm values or git:

- `FUNCTIONS_SERVER_PRIVATE_KEY`: console, rotor and profiles callers.
- `INGEST_FUNCTIONS_SERVER_PRIVATE_KEY`: ingest caller.
- `OPERATOR_FUNCTIONS_SERVER_PUBLIC_KEY`: operator; it passes only the public key to generated functions-server pods.

Upgrade callers first, then operator, then functions-server. Older functions servers ignore
the new signature headers. Updated functions servers require a configured public key and
reject unsigned requests with HTTP 401; health probes remain unauthenticated. Development
setups must also provision keys. Requests bind the method, path/query, deployment ID and
SHA-256 of the exact body to an Ed25519 signature with a 60-second clock-skew window.
This authenticates requests; it does not provide exactly-once execution or replace network isolation.

S2S ingestion requires an explicitly configured private key: a hashed `id:secret` key
or a legacy plaintext private key. Browser collection continues to support public
stream IDs and configured domains.

The workspace feature flag `s2s-slug-auth` is an explicit compatibility exception:
non-strict S2S ingestion may resolve an explicit source-ID slug after missing or invalid
credentials. This allows anyone who knows that source ID to submit S2S events to that
workspace. Enable it only for clients that need this behavior; remove it after migrating
them to valid private keys. It does not enable domain fallback, public-key aliases as
slugs, strict source fallback, or synchronous-function authentication bypass.

| Authentication | Default behavior | With `s2s-slug-auth` |
| --- | --- | --- |
| Valid configured private `id:secret` key | Accepted | Accepted |
| Explicitly configured legacy plaintext private key | Accepted | Accepted |
| Missing/invalid key with explicit source-ID slug, non-strict S2S ingestion | Rejected | Accepted for sources in the opted-in workspace |
| Public stream ID or browser key used only as a write key | Rejected for S2S | Rejected without an eligible explicit slug |
| Domain-only S2S fallback | Rejected | Rejected |
| Strict source or synchronous-function call without a valid private key | Rejected | Rejected |
| Browser collection | Unchanged | Unchanged |

Deploy the console exporter before ingest so opted-in workspaces receive `s2sSlugAuth`
in their stream configuration. Keep manual deployment ordering described above.
