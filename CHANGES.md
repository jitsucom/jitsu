# Jitsu Release Notes

## 2.14.0

First stable release since `jitsu2-v2.11.0` (August 2025). It aggregates ~1,600 commits
of work, including two architectural changes that affect every self-hosted deployment.
Read the **Breaking changes** section before upgrading.

---

### ⚠️ Breaking changes

#### Kubernetes is now required for a feature-complete Jitsu

Two core subsystems moved to Kubernetes-native architectures. A plain docker-compose
deployment can still be used for exploration and development, but a production setup —
functions, profile builders and connector syncs included — now requires a Kubernetes
cluster.

**1. Functions pipeline extracted to dedicated Function Servers managed by an operator** (#1239, #1249, #1252)

- User functions (UDFs) and profile builders no longer run inside the `rotor` event
  consumer. They run in dedicated **function-server** deployments (the same
  `jitsucom/functions-server` image started with `ROTOR_MODE=functions`)
- A new **operator** service (`jitsucom/operator`) reconciles these deployments in
  Kubernetes: it polls the console export, creates/updates per-deployment `Deployment`,
  `Service` (`fs-<deploymentId>:3456`), `ConfigMap`, `HorizontalPodAutoscaler` and
  `PodDisruptionBudget` objects, and records deployment routing in the new
  `FunctionsServer` Postgres table.
- `ingest`, `rotor` and `console` reach function servers via the new
  `FUNCTIONS_SERVER_URL_TEMPLATE` env var (default `http://fs-${workspaceId}:3456`).
- **Upgrade impact: the operator is mandatory for event delivery.** Rotor routes events
  based on the `FunctionsServer` table; connections without function-server routing
  information are dropped. Deploy the operator (with RBAC for pods, services,
  configmaps, secrets, deployments, HPAs and PDBs) before upgrading rotor.
- The legacy in-rotor UDF pipeline was removed (#1280).

**2. Connector syncs moved from Google Cloud Scheduler to Kubernetes CronJobs** (#1287)

- `syncctl` now polls the console's `/api/admin/export/syncs` endpoint and reconciles
  one Kubernetes `CronJob` per scheduled sync (labeled `jitsu.com/managed-by=syncctl`),
  each with its config in a per-sync `Secret`. Scheduled runs execute as autonomous pods
  without calling back into syncctl.
- **`GOOGLE_SCHEDULER_KEY` and all Google Cloud Scheduler integration removed.** No
  replacement configuration is needed — scheduling is native to the cluster. New
  syncctl env vars: `SYNCCTL_REPOSITORY_BASE_URL`, `SYNCCTL_REPOSITORY_AUTH_TOKEN`,
  `SYNCCTL_CRON_TEMPLATE_REVISION`, `SYNCCTL_JOB_ACTIVE_DEADLINE_SECONDS`,
  `SYNCCTL_JOB_BACKOFF_LIMIT`, `SYNCCTL_JITTER_MAX_SECONDS`.

#### Repository and image changes

- **Bulker, ingest, syncctl, sync-sidecar and the connectors codebase were consolidated
  into the `jitsucom/jitsu` monorepo.** Docker images keep their names
  (`jitsucom/bulker`, `jitsucom/ingest`, `jitsucom/syncctl`, `jitsucom/sidecar`) but are
  now built and versioned together with the rest of Jitsu.

#### docker-compose is deprecated in favor of the development Helm chart

**The Docker Compose setup (`docker/`) is deprecated and will be removed in a future
release.** It predates the function-server architecture: it runs neither the operator nor
function servers, so functions, profile builders and connector syncs are not available
there. The recommended way to run development builds of the full Jitsu architecture is
the **development Helm chart** (`helm/`, deploys to Minikube — see `helm/README.md`).

For now the compose file remains in the repository (rebuilt around profiles, with
Redpanda instead of Kafka and zero-config defaults — details in the *Improvements and
fixes* section and `docker/README.md`).

#### Console behavior changes

- **Auth session cookie is host-only by default.** Set the new `AUTH_COOKIE_DOMAIN` env
  var to share the session across subdomains.
- `JITSU_CONSOLE_READ_ONLY_UNTIL` removed — replaced by the new maintenance mode
  (`MAINTENANCE` / `MAINTENANCE_CONFIG_FILE`).
- Console API is rate-limited by default with a sliding-window per-minute limiter
  (`MINUTE_RATE_LIMIT_ENABLED`, default on; tune with `MINUTE_RATE_LIMIT_BASE`).
- Invalid or missing environment configuration now fails console startup with an
  explicit error instead of silently falling back to defaults.

#### Other breaking / behavior changes

- `MAX_INGEST_PAYLOAD_SIZE` default lowered to 1,000,000 bytes.

---

### ✨ New features

- **Functions Server platform** — per-workspace function execution with `free` /
  `dedicated` / `premium` classes, seamless class transitions, sharding, autoscaling
  (HPA), pod disruption budgets and a Deno-based runtime (#1239, #1249).
- **Profile Builder v2** running on function servers, with configurable MongoDB /
  warehouse / UDF timeouts (#1252).
- **MCP server** — Jitsu console now exposes a Model Context Protocol server with OAuth
  2.1 and Dynamic Client Registration (#1303), plus MCP auth via personal API keys
  (JITSU-66). MCP tools cover config CRUD and live event inspection.
- **OpenAPI spec + API reference** — the console API (including the Sync API) is
  described by a generated OpenAPI spec with a built-in Scalar API viewer.
- **User API tokens** with names, types and expiration dates, managed on a redesigned
  account page.
- **Audit log** (SOC2-oriented) with account-activity alerts, UI/API/CLI origin tags
  (#1288) and a workspace filter in the admin view (#1386).
- **Maintenance mode** — read-only API mode and a friendly "database down" page.
- **Dead-letter queue and reprocessing** — failed events are dead-lettered (#1227) and
  can be replayed by the new reprocessing worker; oversized messages are trimmed before
  dead-lettering. Email notifications for unrecoverable events.
- **Batched sync/connection notifications** summarized by table, with flapping detection.
- **Redesigned signup flow** — real email/password auth with server-side email
  verification, plus OIDC (`AUTH_OIDC_PROVIDER`) improvements. Signups can be restricted
  to work emails with the new `LIMIT_PERSONAL_EMAILS` env var (JITSU-70).
- **Segment-style `sentAt` clock-skew correction** for batch ingestion.
- **events_log retention via ClickHouse TTL** instead of periodic scan-and-delete.
- **Development Helm charts** (`helm/` + `helm-deps/`) — deploy development builds of
  all Jitsu services (including the operator and function servers) to Minikube with
  **zero configuration**, building each service in init containers from local sources
  (#1240, #1384, #1387). All dependencies — single-node PostgreSQL, ClickHouse, MongoDB
  and Kafka (Redpanda) — run in-cluster via the separate `helm-deps` chart;
  `dev-deploy.sh deploy` installs it first, waits for every dependency to be healthy,
  auto-generates the inter-service secrets, applies the console DB schema on every
  deploy, and reports per-component readiness. Go builds are serialized and
  resource-capped so they can't overload the node. It **replaces the deprecated Docker
  Compose setup** as the recommended way to run development builds of the full
  Kubernetes architecture; see `helm/README.md`.
- **Dev experience**: layered `.env.local` loading, `dev-scripts` package (`pnpm dev`),
  hot-reload docker-compose profile, `copy-db` tool.

### 🔌 New integrations

- **Resend** email destination (JITSU-71)
- **SendGrid** email destination (JITSU-71)
- **Statsig** destination
- **DuckDB / MotherDuck** warehouse destination
- **Xero** source connector (Jitsu-maintained)
- **Google Tag Manager**: "Load GTM" toggle, `resetDataLayer` option
- **Snowflake**: key-pair authentication
- **Firebase source**: subcollection sync via CollectionGroup queries
- **Postgres destination**: Google Cloud Private Service Connect authentication
- **Redshift**: IAM role-based authentication improvements, SUPER type for JSON columns

### 🛠 Improvements and fixes

- Sources: connector specs auto-reload when the image is newer than the cached spec;
  per-stream error isolation for Firebase; sidecar watchdogs and bounded state writes.
- Sync jobs: cancellation scoped to task (not whole sync); accurate started-at times
  from pod status; sync quota initialization; OAuth token refresh runs as an init
  container (`NANGO_API_HOST`, `NANGO_SECRET_KEY`, `GOOGLE_ADS_DEVELOPER_TOKEN`);
  task-log retention settings `SYNC_TASK_LOG_SIZE` / `SYNC_TASK_LOG_AGE` moved from
  console to syncctl.
- Bulker / warehouses: Snowflake MERGE split into dedup + UPDATE + INSERT with large
  performance gains; ClickHouse batch inserts, partial JSON type support and `ON CLUSTER`
  quoting; multi-partition retry topics; batch deduplication; consumer backpressure;
  `spreadTablesSchedule` option; memory and allocation optimizations.
- Ingest: pixel endpoint click tracking (`destination_url`), event throttling, weighted
  partition selection (optional), batch endpoint deduplication, failover logger with S3
  offload; `track` event-name restrictions removed.
- Functions: `fetch()` timeout is configurable via `FETCH_TIMEOUT_MS` (default 2000 ms)
  instead of being hardcoded (#1254).
- Console: search filters on all entity lists; linked-entity checks on deletion;
  provisioned destination credentials masked; billing/subscription-status fixes;
  hardened HTTP security headers; numerous UI fixes.
- JS SDK (`@jitsu/js`): `identify()` on init when `userId` is provided,
  `preInitAnonymousId` option, GA4 new session-cookie format support (#1219).
- `jitsu-cli`: config command tree, OpenAPI spec dump, default workspace support,
  function cache consistency fixes.
- Security: continuous dependency CVE patching across Go and npm stacks; API tokens and
  internal secrets generated with a cryptographically secure RNG (#1356); tokens no
  longer exposed in error messages; DNS caching for outbound HTTP pools.
- docker-compose (deprecated): rebuilt around profiles (`jitsu-services`,
  `jitsu-dependencies`, hot-reload `jitsu-services-dev`); Redpanda replaces the bitnami
  Kafka; Redis dropped from the default stack (functions state in MongoDB, events log in
  ClickHouse; `REDIS_URL` still supported); zero-config defaults with a seeded admin
  login; renamed vars (`DOCKER_TAG` → `RELEASE_TAG`, `JITSU_UI_PORT` → `CONSOLE_PORT`,
  `JITSU_INGEST_PORT` → `INGEST_PORT`, default 8080 → 3049) — see `docker/README.md`.
- Toolchain: Node.js ≥ 22, pnpm ≥ 10, Go 1.26, Next.js 16; rotor migrated to the
  Confluent Kafka client (#1222); npm packages published via OIDC trusted publishing
  (#1255).
- CI/CD: multi-arch (amd64 + arm64) images, AI code review on every PR, automated beta
  releases from `newjitsu`, MIT license declaration with third-party notices.

---

For configuration details of the new services (operator, function servers, CronJob-based
syncs), see the [self-hosting documentation](https://docs.jitsu.com/self-hosting).
