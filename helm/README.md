# Jitsu Kubernetes Helm Chart

Helm chart for deploying Jitsu services to Kubernetes.

The chart has two modes, selected by `mode` in `values.yaml`:

- **`dev`** (default) — services are built from source inside init containers
  against a hostPath-mounted checkout, so no local build step is required. This
  is what the rest of this README describes, and it targets Minikube.
- **`prod`** — services run published `jitsucom/*` images. No source build, no
  hostPath, `projectRoot` unused, every Service `ClusterIP`, and an optional
  Ingress for console and ingest.

## Production mode

### What the cluster must give you

**Permission to create RBAC objects.** The chart creates eight: two ClusterRoles,
two ClusterRoleBindings, two Roles and two RoleBindings. Two of them are
cluster-scoped, so namespace-admin is not enough. On GKE, `roles/editor` is not
enough either — it deliberately excludes RBAC — and the install fails at the
pre-install hook with `cannot delete resource "roles" ... requires one of
["container.roles.delete"]`. `roles/container.admin` covers it.

**A default StorageClass**, if you use `helm-deps`. It creates four 5Gi PVCs
and does not set `storageClassName`, so they bind to whatever the cluster
defaults to. With no default StorageClass they stay `Pending` and the install
waits without a useful error.

### What the chart grants, and why

Worth reading before you hand it to a cluster you care about.

| Object | Scope | Grants | Why |
|---|---|---|---|
| `jitsu-operator` | Cluster | CRUD on pods, services, configmaps, secrets, deployments, statefulsets, HPAs, PodDisruptionBudgets | it creates and manages the per-workspace functions-server deployments |
| `jitsu-syncctl` | Cluster | the same, plus `jobs`/`cronjobs`, `pods/log` get, `pods/exec` create | it runs each connector sync as a pod, tails its logs on failure, and samples CPU/memory by exec-ing into the running container |
| `jitsu-sync-pod` | Namespace | `leases` | leader election between sync pods |
| `jitsu-token-generator` | Namespace | `secrets`: get/patch **restricted to `jitsu-secrets`**, plus **unrestricted create** | generates the inter-service tokens; see the note below on why `create` cannot be narrowed |

Two are worth flagging explicitly rather than leaving to be discovered:

- **`pods/exec` create** on syncctl is effectively shell access to pods in scope.
  It is used for resource sampling (`JobRunner.getPodResUsage`), not arbitrarily.
- **The token-generator can create Secrets of any name** in the release
  namespace. `get` and `patch` are pinned to `jitsu-secrets` with
  `resourceNames`, but Kubernetes cannot apply `resourceNames` to `create` —
  there is no object yet to authorize against — so that verb is namespace-wide
  by construction. Pre-creating an empty Secret so the Job needs only `patch`
  was considered and rejected: `lookup` is empty during `helm template`,
  `--dry-run` and Argo CD rendering, so a templated Secret would blank the live
  keys on every upgrade. The grant is therefore deliberate, not an oversight.
  Set `tokenGenerator.enabled=false` and manage `jitsu-secrets` yourself if it
  is unacceptable.
- **The two ClusterRoles are cluster-scoped**, so their secrets and pods access
  spans every namespace, not just the release namespace. If that is too broad
  for your cluster, both are ordinary templates and can be narrowed to Roles in
  a fork — at the cost of syncs and functions-servers being confined to one
  namespace.

Dependencies first. The main chart does not install them, so on a fresh cluster
there is no Postgres, Kafka, ClickHouse or MongoDB, no `jitsu-deps-urls` Secret,
and the console crashes without `DATABASE_URL`:

```bash
helm install jitsu-deps ./helm-deps --wait --timeout 5m
```

`--wait` matters: without it the command returns as soon as the objects are
created, and the main chart can start while Postgres is still booting. The
console's entrypoint runs `prisma db push` once and does not check whether it
succeeded, so on a lost race the schema is missing, `/api/healthcheck` returns
503 (it does a `workspace.findFirst`), and the entrypoint's healthcheck kills the
container. Kubernetes restarts it and the migration runs again, so the install
usually recovers by itself — but it crash-loops on the way, and it only recovers
if Postgres is ready before the post-install seed Job exhausts its five-minute
wait. Every dependency here has a readiness probe (Postgres uses `pg_isready`),
so `--wait` removes the race rather than just delaying it.

`5m` is Helm's own default and is comfortable on a normal cluster — the four
images are roughly 600 MB compressed in total and pull in parallel. Raise it on a
slow link; `kubectl get pods -w` will show you whether it is still pulling or
genuinely stuck.

`helm-deps` runs **single-node** instances and is not production-grade — see the
caveat below. For a real deployment, point the services at managed instances
instead: disable each component in `helm-deps/values.yaml` and set the matching
`env.common.DATABASE_URL` / `KAFKA_BOOTSTRAP_SERVERS` / `CLICKHOUSE_URL` /
`MONGODB_URL` here.

Then the chart itself:

```bash
helm install jitsu ./helm --wait --timeout 5m \
  --set mode=prod \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.hosts.console=jitsu.example.com \
  --set ingress.hosts.ingest=events.example.com
```

`--wait` here for the same reason as the dependency install above, and it is not
cosmetic. Without it Helm returns as soon as the objects are created: on a real
cluster that means **exit 0 while five services are in `CrashLoopBackOff`**.
Every service that reads its configuration from the console — bulker, ingest,
operator, profiles, rotor, syncctl — exits rather than retrying when the console
is not up yet (`Cannot load cached repository. No CACHE_DIR is set.`), so they
restart a few times until it is. The install recovers on its own, but a bare
`helm install` reports success in the middle of that, which is the worst moment
to walk away from it.

`5m` has comfortable headroom: a measured cold start into an empty namespace,
including a node scale-up, reached all-running in about 2 minutes.

**TLS is off in that command on purpose.** Turning `ingress.tls.enabled=true` on
without also giving the certificate a source leaves you worse off than plain
HTTP: ingress-nginx falls back to its own self-signed certificate, the chart
still derives `https://…` for the console's NextAuth URL, and the browser rejects
the certificate — so nobody can log in. Enable TLS together with one of:

```bash
# a) you already hold a certificate, in a TLS Secret in the release namespace
  --set ingress.tls.enabled=true \
  --set ingress.tls.secretName=jitsu-tls

# b) cert-manager issues it — leave secretName empty and point at your issuer
  --set ingress.tls.enabled=true \
  --set ingress.annotations."cert-manager\.io/cluster-issuer"=letsencrypt-prod
```

For (b) both hostnames must already resolve to the ingress controller, or the
ACME HTTP-01 challenge cannot complete.

No secrets on the command line, deliberately. A pre-install Job generates the
inter-service tokens, the console's `JWT_SECRET` and the initial admin password
into the `jitsu-secrets` Secret, which every service mounts via `envFrom`. Values
passed with `--set` would instead land in the pod spec, in Helm's release record
(`helm get values`), and in your shell history.

The Job never rewrites a key that is already set, so upgrades do not rotate the
tokens. It does fill in keys that are *missing*, which is what makes a dev
release upgradable to `mode=prod` and lets an older install pick up keys added by
a later chart version.

**To manage the secret yourself** — external secret manager, SealedSecret,
GitOps — create `jitsu-secrets` before installing and leave `auth.token` unset.
The Job will see it and only backfill absent keys; supply all of them and it does
nothing at all. To stop the chart touching the Secret under any circumstances,
also set `tokenGenerator.enabled=false`, and note that every key then becomes
your responsibility.

`auth.token` is a different thing and is **not** the external-secrets path: it
renders the value into the Secret template, so it ends up in the rendered
manifest and in Helm's release record (`helm get values`) — the very exposure the
generated path avoids. Use it for a throwaway environment, or where you already
accept the token being in your values file.

Setting it requires two more values, and both are deliberate rather than
bookkeeping:

- **`auth.jwtSecret`** — console signs its session cookies with this. It must be
  a *different* value from `auth.token`, and not derived from it. Every other key
  in that path hands `auth.token` to a service as a bearer credential, and those
  travel on service-to-service requests; if the session-signing secret were the
  same value, anyone who obtained one of those credentials could sign their own
  console session and hold an admin one. Hashing `auth.token` would not help —
  the derivation is in the chart, so the token still yields the secret. The
  chart refuses to render if the two are equal — this is enforced, not just
  asked for.
- **`auth.seedPassword`** — required when `seed.enabled`, because the generated
  path mints a seed password and this one cannot invent one. Without it the seed
  Job creates no user and nobody can sign in.

The generated path has neither problem: the Job mints an independent 48-character
`JWT_SECRET` and its own seed password.

**Retrieve the initial login** after installing:

```bash
kubectl get secret jitsu-secrets -o jsonpath='{.data.SEED_USER_PASSWORD}' | base64 -d
```

The user is `env.console.SEED_USER_EMAIL` (default `admin@example.com`), created
by a post-install Job, and the password must be changed at first login. Without
that Job a fresh install has a migrated database and no user at all — the
published console image only seeds when `SEED_DEMO_CONFIGURATION` is set, which
also creates demo connections.

Dependencies are still the `../helm-deps` chart's single-node Kafka, Postgres,
ClickHouse and MongoDB, which are **not** production-grade. Point a prod install
at managed instances by disabling them there and setting the matching
`env.common` connection URLs.

`ingress.hosts.console` also determines the console's public URL (NextAuth
redirects, tracking snippet). Without an Ingress, set
`env.console.NEXTAUTH_URL` and `env.console.JITSU_PUBLIC_URL` explicitly.

Prod mode has not yet been verified end to end on a real cluster — that is the
remaining work in `JITSU-48`.

## Development mode

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
For Google Ads API streams, optionally add `GOOGLE_ADS_DEVELOPER_TOKEN` to this
runtime Secret as the fallback when a destination has no developer token. A
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
