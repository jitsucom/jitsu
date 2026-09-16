# Executable runner and syncctl

The existing PostgreSQL and mirror libraries now run in one Node application
container. No long-running Go sidecar is used. The compiled-in adapter registry
is deliberately empty: live providers, OAuth refresh, the Reverse sync editor
and production enablement follow separately. The existing API guard against
creating Reverse sync links remains in place. Tests supply fake bindings.

## Deployment prerequisites

Configure `SYNCCTL_REVERSE_ENABLED=true`, `SYNCCTL_REVERSE_RUNNER_IMAGE`,
`SYNCCTL_REVERSE_RUNTIME_SECRET`, and `SYNCCTL_PODS_SERVICE_ACCOUNT`. Normal
repository URL/token/namespace settings still apply. `retl-runner` is a target in
`all.Dockerfile` and the existing services release workflow. This PR does not bump
a release version, provision infrastructure, or deploy anything.

The pre-provisioned runtime Secret must contain:

| Key | Purpose |
| --- | --- |
| `RETL_DATABASE_URL` | Restricted DB login, including `?schema=newjitsu` (or configured schema). Never migration credentials. |
| `RETL_CONSOLE_URL` | Reachable console origin. |
| `RETL_CONSOLE_TOKEN` | Console `SYNCCTL_AUTH_KEY` for per-run admission. |

No payload-encryption key is required. Recovery payloads and checkpoint state are
stored as readable JSON; protect database and backup access as described in the
package README. DB and admission credentials still belong in Kubernetes Secrets.

Use the database grants in the package README. The service account needs
namespace-scoped `get`, `create`, `update`, `delete` on `coordination.k8s.io/leases`.
Node reloads its projected account token per request and validates TLS using the
projected CA. It does not need Kubernetes Secret API access. The controller keeps
its existing Pod/CronJob/Secret permissions.

`SYNCCTL_REVERSE_ENABLED` opts the controller into managing the new feed. It is
not an emergency kill switch for existing CronJobs: disable the link or workspace
`reverse-etl` feature to block fresh admission. Cancellation remains available
even when the controller option is disabled.

## Scheduling and admission

- `/api/admin/export/reverse-syncs` is an independently authenticated desired-state
  feed. Corrupt active entries fail the whole export; failed/missing loads retain
  that feed's last-known-good snapshot and never authorize deletion.
- The shared reconciler scopes resources by `jitsu.com/sync-kind`; connector and
  reverse feeds cannot delete each other's jobs. Names hash the case-sensitive
  sync ID. CronJobs use timezone, `Forbid`, no automatic retries and active deadlines.
- The per-sync Secret contains `reverse.json`; Pods contain no plaintext
  credentials and use one non-root `retl-runner` container.
- Manual runs use authenticated syncctl `POST /read?kind=reverse&workspaceId=...&syncId=...&updatedAt=...`.
  It returns `taskId` and `podName`. Stale repository resolution fails closed.
- Cancel via `GET /cancel?kind=reverse&workspaceId=...&syncId=...&taskId=...`.
  Matching is exact for workspace/task, including cron-generated task names.
  Cancellation before Node startup prevents that task from starting. These are
  controller APIs, not new browser routes.
- Before provider construction/extraction, Node re-fetches one scoped config from
  console. Disabled/deleted/foreign configs, maintenance/read-only mode, failed
  admission or delivery-revision mismatch stop the run. No stale fallback or billing call.

Schedules and checkpoint cadence are not delivery revisions. Model, warehouse,
destination credentials and delivery settings are: changing them with retained
state requires the existing controlled-reset workflow, not implemented here.
Never edit raw SQL state to bypass that guard. The first OAuth provider must
explicitly define its refresh/credential-revision policy.

## Supervision and task state

Node acquires a 60-second Kubernetes lease before PostgreSQL ownership. Every
10 seconds it renews Kubernetes, PostgreSQL, then the `source_task` heartbeat.
Any failure cancels execution. CAS resource versions protect Kubernetes ownership;
database epochs fence durable effects. Already-started remote calls cannot be fenced.

Signals, lease loss and runtime deadlines share an AbortSignal. Node waits for
callbacks and reader cleanup before releasing leases, with a 45-second hard
shutdown watchdog (Pod grace: 60 seconds). Forced exit retains prepared evidence
and lets leases expire instead of pretending remote changes were rolled back.

`source_task`/`task_log` store core lifecycle messages and status. Provider strings
and raw SDK errors are suppressed because they can contain tokens or row values;
a structured redacted provider logger can be added separately. Controller updates
never infer delivery success from exit zero or refresh a heartbeat from PodRunning.
Terminal SUCCESS/CANCELLED/FAILED survives later controller observations. Every
30 seconds the controller fails up to 100 reverse tasks with heartbeats older than
two minutes; the Pod watcher independently retries UID-scoped termination of
terminal reverse tasks, including after transient API failures. Init/runtime deadlines also cover
unscheduled Pods and crashes before heartbeat creation.

## Recovery and maintenance

Unfinished control records retain their logical run ID, revision, mode and target;
each attempt gets a fresh task ID. Recovery never opens changed source SQL.

- Sealed mirrors resume core planning with exact persisted provider requests.
- Pending/unknown finish requires verified provider reconciliation. Accepted
  finish retries commit the persisted cursor locally without another remote call.
- Unknown initialization needs explicit absence/cleanup proof before reset.
- Interrupted upsert extraction, unsealed mirrors and rejected mirror runs
  reconcile outstanding work and abort through verified cleanup hooks. That attempt
  ends without a fresh scan; the next attempt starts from committed state.
- Missing proof/hooks keep recovery blocked. No blind replay/session creation.
- Pending delivery records FAILED with an explicit pending/recovery message, not
  SUCCESS. The next scheduled/manual attempt reconciles; there is no tight retry loop.

Fenced maintenance prunes abandoned generations and terminal old-run receipts in
bounded pages before delivery, retaining receipts for 30 days. `source_state`
continues to hold compact cursor/store state. No billing or association tables.

## Validation

`pnpm --filter @jitsu-internal/retl-runner build` produces `dist/main.cjs`.
Runner tests use disposable PostgreSQL and fake provider bindings. Set
`RETL_MIRROR_SCALE_TEST=1` to include the existing million-identity SQL pagination
test. Console integration tests verify scoped export/admission data; controller
tests use fake Kubernetes clients for templates, feed isolation, malformed inputs
and terminal Pod policy. No production database, Kubernetes cluster or ads API is used.
