# Refresh lifecycle decisions

- A logical run keeps its original task ID and log stream.
- Automatic checks stop on FAILED; explicit Refresh status can resume retained delivery.
- A transient check failure retains delivery state, schedules another bounded check, and logs ERROR.
- A final ambiguous provider result remains FAILED rather than being treated as a network error.
- Permanent row rejection still fails immediately, even if other batches remain pending.
- Manual/cron admission cannot create another task for an existing pending non-detached run.
- Detached submitted runs do not block new model extractions.
- A status-refresh request validates workspace, revision, run binding, and inactive worker before launch.
- A queued or stale worker cannot bypass a suspended schedule or change a newer worker's status.
- Reverse Pod cleanup uses UID-conditional deletion without caching reusable Pod names.
- Worker generations keep increasing across explicit retries; only the polling delay is capped.
- Redacted terminal replacement errors retain their terminal meaning after mirror error wrapping.
- Post-delivery bookkeeping failures cannot reopen polling against a terminal persistence control.
- No-op cursor runs can update the shared store without superseding an older pending run's checkpoint.
- Checkpoint ordering is tracked separately in existing JSON state; legacy state falls back to runOrder, with no schema migration.
- History retention preserves tasks with saved delivery bindings, including failed/cancelled ones, without depending on RETL tables.
- Updated At keeps its existing heartbeat/update behavior; no live database changes or resets are required.
