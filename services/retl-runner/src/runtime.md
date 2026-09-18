# Executable runner and syncctl

The existing PostgreSQL and mirror libraries now run in one Node application
container. No long-running Go sidecar is used. The compiled-in registry includes
Google Data Manager Customer Match additions/explicit removals, with scoped OAuth
and durable request polling. Jitsu-managed audiences additionally support core
snapshot mirroring with 30-day unchanged-member refresh and 540-day membership.
The console provisions audiences separately and exports server-recorded creation
evidence bound to one sync; the runner verifies that binding remotely each attempt.
Existing audiences remain additions/explicit removals only. The Reverse sync editor
and production enablement follow separately; the API guard against creating Reverse
sync links remains in place.

## Deployment prerequisites

Configure `SYNCCTL_REVERSE_ENABLED=true`, `SYNCCTL_REVERSE_RUNNER_IMAGE`,
`SYNCCTL_REVERSE_RUNTIME_SECRET`, and `SYNCCTL_PODS_SERVICE_ACCOUNT`. Normal
repository URL/token/namespace settings still apply. `retl-runner` is a target in
`all.Dockerfile` and the existing services release workflow. This PR does not bump
a release version, provision infrastructure, or deploy anything.

Apply the Prisma schema before deploying this runner: membership `last_accepted_at`
and generation `refresh_before` are additive fields used by snapshot planning.
The existing restricted table grants cover these columns; no runtime DDL is added.

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
Never edit raw SQL state to bypass that guard. Google OAuth refresh does not change
the delivery revision: only a connection reference, not its token, is in the config.
Changing the connection reference/account/audience remains revision-bound.

Google tokens are resolved through `/api/admin/reverse-sync-oauth/:syncId` using the
same service bearer token, plus workspace and immutable delivery revision. Console
checks current admission before and after Nango retrieval, verifies the connection
is `destination.<toId>` and uses only the code-owned Google integration. The runner
receives only an access token/expiry, cached in memory for at most four minutes and
never beyond expiry minus the safety margin. The shared Nango secret and refresh
token never reach the runner. Redirects are forbidden. Disabling the sync stops new
token issuance; an already cached/in-flight token is not instantly revoked.

See the [Google adapter contract](../../../libs/destination-functions/src/functions/google-ads-reverse/README.md)
for OAuth scopes, mapping/consent, and unrecoverable ambiguous-request limitations.

## Supervision and task state

Node acquires a 60-second Kubernetes lease before opening PostgreSQL persistence.
Every 10 seconds it renews that lease, then the `source_task` heartbeat. Any failure
cancels execution. Kubernetes leases and syncctl are the sole worker coordination
mechanism; CAS resource versions protect Kubernetes ownership. PostgreSQL provides
atomic state transactions, not worker leases or epochs. A paused worker or an
already-started remote call is not forcibly fenced after lease expiry.

Signals, lease loss and runtime deadlines share an AbortSignal. Node waits for
callbacks and reader cleanup before releasing the lease, with a 45-second hard
shutdown watchdog (Pod grace: 60 seconds). Forced exit retains prepared evidence
and lets the lease expire instead of pretending remote changes were rolled back.

`source_task`/`task_log` store core lifecycle messages and status. Provider strings
and raw SDK errors are suppressed because they can contain tokens or row values;
a structured redacted provider logger can be added separately. Controller updates
never infer delivery success from exit zero or refresh a heartbeat from PodRunning.
Terminal SUCCESS/CANCELLED/FAILED/WAITING/RESUMED survives later controller observations. Every
30 seconds the controller fails up to 100 reverse tasks with heartbeats older than
two minutes; the Pod watcher independently retries UID-scoped termination of
terminal reverse tasks, including after transient API failures. Init/runtime deadlines also cover
unscheduled Pods and crashes before heartbeat creation.

## Recovery and maintenance

Unfinished control records retain their logical run ID, revision, mode and target;
each attempt gets a fresh task ID. Recovery never opens changed source SQL.

- Sealed mirrors resume core planning with exact persisted provider requests.
- Streams declaring `batchDelivery: "asynchronous"` resolve batches independently
  of finish. Completed upsert extraction is sealed in `batches_pending`; subsequent
  attempts poll the bounded journal, then attach the existing writer and finalize
  only when every batch is accepted. No source is reopened and no checkpoint crosses
  staged work. This phase uses the existing control table; no migration is needed.
- Independent upsert jobs require distinct projected member identities within one
  extraction (including removes). Overlaps are rejected before the conflicting
  request, because independent provider jobs may complete out of source order.
  Mirror shared-identity deduplication remains unchanged.
- Pending/unknown finish requires verified provider reconciliation. Accepted
  finish retries commit the persisted cursor locally without another remote call.
- Unknown initialization needs explicit absence/cleanup proof before reset.
- Interrupted upsert extraction, unsealed mirrors and rejected mirror runs
  reconcile outstanding work and abort through verified cleanup hooks. That attempt
  ends without a fresh scan; the next attempt starts from committed state.
- Missing proof/hooks keep recovery blocked. No blind replay/session creation.
- Pending delivery ends its worker attempt as **WAITING**, with no error and a
  clean process exit. It is not delivery SUCCESS. The console shows provider
  processing and the next check time; the Pod watcher cleans up the worker.
- `source_task.metrics.reverseRecovery` stores the logical run/revision, attempt,
  next check and fixed deadline. No extra table or schema migration is required.
  The first check is due after 30 minutes; subsequent intervals multiply by 1.3
  up to one hour. The last interval is shortened to the 24-hour deadline. If that
  check is still pending, the task becomes FAILED with an explicit timeout; all
  receipts/checkpoints are retained. Scheduling delays may postpone that final
  check. A later manual/cron attempt can reconcile again but does not reset the
  same logical run's automatic polling window.
- Syncctl scans due checks every 30 seconds on a separate loop, independently of
  model CronJobs (including manual-only syncs). It launches a bounded, one-shot
  recovery Pod with a deterministic task name per waiting parent. Repeated scans
  and controller replicas cannot create different tasks for the same check.
  The current feed must match workspace/revision; Node then rechecks the durable
  run and due time under its Kubernetes lease and performs fresh console admission.
- Starting a recovery/manual/cron attempt atomically marks prior WAITING attempts
  **RESUMED**. A queued recovery Pod cannot revive a cancelled/superseded parent
  or start a fresh extraction. Each check gets a fresh task ID; its outcome is
  separate from the previous waiting attempt. Real provider failures or failed
  workers remain FAILED rather than being retried automatically forever.
- WAITING tasks can be cancelled without a live Pod, including after rollout or
  entity disablement. Cancellation stops that automatic recovery chain, not the
  model's regular CronJob or provider work already submitted. A later explicit
  or regularly scheduled run may still reconcile retained delivery state.

Deploy the runner **and syncctl** to enable WAITING and automatic recovery together;
the controller must recognize WAITING/RESUMED for cleanup. The console label only
deploys the console, not these services. Syncctl's DB role needs SELECT on
`reverse_sync_control` alongside its existing `source_task` permissions.

Next-run admission compacts accepted membership into durable baseline files and
discards the abandoned candidate from the new head. No SQL row sweeper remains.
Object garbage collection is deferred; do not configure age-only bucket deletion.
`source_state` continues to hold compact cursor/store state. See the mandatory
[storage cutover](artifacts/README.md) before deploying; old workers must be stopped
before dropping the legacy payload tables. No billing or association tables.

## Validation

`pnpm --filter @jitsu-internal/retl-runner build` produces `dist/main.cjs`.
Runner tests use disposable PostgreSQL and fake provider bindings. Set
`RETL_MIRROR_SCALE_TEST=1` to include the million-identity SQLite pagination
test. Console integration tests verify scoped export/admission data; controller
tests use fake Kubernetes clients for templates, feed isolation, malformed inputs
and terminal Pod policy. Setting `SYNCCTL_TEST_DATABASE_URL` to a disposable
PostgreSQL database also exercises due-check selection, terminal cleanup and scoped
cancellation; that test creates/drops only its own unique schema. No production
database, Kubernetes cluster or ads API is used.
