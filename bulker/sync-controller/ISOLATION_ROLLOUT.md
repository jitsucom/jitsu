# Connector isolation and fast shutdown

Process isolation is unconditional: all connector Pods use
`shareProcessNamespace: false`. There is no setting to turn sharing back on.

`SYNCCTL_SYNC_FAST_SHUTDOWN_IDS` controls only the optional shutdown supervisor:

- Empty (default): sidecar exits on lease loss and syncctl cleans up the Pod.
- Comma-separated exact sync IDs: enable the supervisor for those syncs only.
- `*`: enable it for every connector task, including inline spec/check/discover.

The selected source container runs its connector entrypoint beneath a shell
supervisor. On lease loss, the sidecar writes `/shared/terminate` and exits
nonzero. The watcher signals the supervisor, which exits immediately; Linux
then terminates the remaining processes in that container's PID namespace.
Normal SIGTERM/SIGINT is forwarded to the connector entrypoint, and the
supervisor waits for it to finish. Kubernetes enforces the Pod's configured
termination grace period if the connector does not stop. Connector entrypoints
must propagate graceful termination to any subprocesses they start.

The sentinel is a shutdown optimization, not a security boundary. A connector
can interfere with its own watcher or shared files. A failed sentinel write is
logged, and the nonzero sidecar exit still triggers controller Pod cleanup.

## Image inventory before enforcement

`SYNCCTL_SYNC_ALLOWED_IMAGE_PREFIXES` is comma separated; empty allows all images.
Use namespace boundaries, for example `airbyte/,jitsucom/`, rather than `airbyte`.
Matching is against the configured package string, so fully qualified registry
names need their own prefixes. Rejecting a manual task creates no Pod or Secret.
Rejected scheduled syncs lose their CronJob; Kubernetes background deletion also
removes its owned Jobs/Pods. Inventory and review exceptions before enabling it.

These read-only commands list source images without dumping Pod environments or
Secret contents. Set the intended context and namespace explicitly:

```sh
kubectl --context CONTEXT -n NAMESPACE get cronjobs \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.jobTemplate.spec.template.spec.containers[?(@.name=="source")].image}{"\n"}{end}'
kubectl --context CONTEXT -n NAMESPACE get pods \
  -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[?(@.name=="source")].image}{"\n"}{end}'
```

Also check configured manual-only sync packages and connectors offered for
spec/check/discover; running Pods and CronJobs alone do not cover those. Configure
prefixes only after all required images have been accounted for. Removing the
allowlist recreates eligible CronJobs on reconciliation but does not restore an
interrupted run.

## Rollout

1. Publish the updated sidecar and syncctl. Set the new sidecar image in syncctl,
   leaving fast-shutdown IDs empty. Deploy syncctl and verify existing CronJob
   templates reference the new sidecar. Keep existing process isolation.
2. After reviewing the image inventory, enable the image allowlist separately
   from the shutdown change. Confirm required manual and scheduled runs work.
3. Set `SYNCCTL_SYNC_FAST_SHUTDOWN_IDS` to one test sync ID. Verify that sync's
   CronJob gains the wrapper and `TERMINATE_SENTINEL`; other syncs stay unchanged.
   Existing running Pods are not retrofitted: use a newly created run.
4. With a real connector and disposable source/destination, verify spec, check,
   discover and read; successful completion; user cancellation; lease takeover;
   checkpoint/retry behavior; and a failed sentinel write. Check that source and
   sidecar stop and no overlapping reader remains after lease loss. The Go tests
   cover nonzero sidecar exit even when the sentinel is unavailable.
5. Expand the sync ID list, then use `*` only after representative connectors pass.
   Roll back supervision by clearing the ID list; isolation stays enabled. Keep
   the updated sidecar until all supervised Pods finish.

## Local regression tests

```sh
cd bulker
go test -short ./sync-controller ./sync-sidecar
docker pull alpine:3.22
docker pull python:3.12-slim
JITSU_TEST_DOCKER=1 go test -short -run TestConnectorSupervisorInContainer ./sync-controller
```

The Docker tests use real isolated PID namespaces and a non-root UID with Alpine
and Debian shells. They verify completion, lease loss with a TERM-ignoring
connector, and graceful SIGTERM cleanup. They use synthetic connectors and do
not replace a full Airbyte sync canary or a real Kubernetes lease takeover test.
