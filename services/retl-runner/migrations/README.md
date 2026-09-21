# Per-run lifecycle cutover

The `per-run-control.sql` migration preserves every control row, artifact reference,
checkpoint, task and log. It changes the control primary key from workspace/sync
to workspace/sync/run and adds a per-sync admission order plus a submitted-work flag.
It does not reset audiences or create/delete destination data.

1. Back up the configuration database and preserve the object-storage prefix.
2. Pause Reverse ETL syncs, suspend their CronJobs, stop syncctl's refresh scheduler,
   block console mutations, and drain all Reverse ETL workers/leases. Do not run
   old and new runners/controllers concurrently during this cutover.
3. As the database owner, apply `per-run-control.sql` with `psql`, supplying the
   existing configuration schema through `-v schema=...` and `ON_ERROR_STOP=1`.
   This is explicit operator work, not an automatic runner startup migration.
4. Deploy the matching runner, syncctl and console. Generate the Prisma client
   from the updated schema. Do not use a destructive `db push --accept-data-loss`.
5. Verify row counts and artifact/checkpoint values against the backup. Resume
   scheduling and restore each sync's previous enabled/paused setting.

Existing WAITING tasks are readable and refreshable. Their next check reuses that
task ID; older RESUMED task history is left intact, not retroactively rewritten.
Only verified complete initial uploads release a run for overlapping extraction.
Legacy snapshots without comparison counts may need to finish before release.

Each fresh run gets a new task and control row; refresh pods get distinct pod
identities but reuse that task. `source_task.description` is the current readable
summary, `task_log` is append-only history, and task metrics hold the refresh
schedule, active-worker identity and aggregate delivery counts. Worker metadata
does not replace the existing Kubernetes per-sync lease.

Multiple runs can process remotely at once, including mirror uploads/removals.
This does not guarantee provider processing order: while they overlap, older
changes can still finish after newer ones. Pending memberships are retained as
potential baseline members and refreshed when desired by a later snapshot.
Late older checkpoints cannot overwrite a newer committed checkpoint. Receipts
remain attached to their own run; pending or uncertain work is never called accepted.

No retention deletion of control rows is introduced. Once multiple runs exist,
rolling back to the old single-row schema/binaries requires a separately planned
state-preserving rollback; do not drop rows to recreate the old unique key.
