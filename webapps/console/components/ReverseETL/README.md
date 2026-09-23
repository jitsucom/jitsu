# Reverse ETL console

The workspace feature flag is `reverse-etl`. Existing syncs remain reachable for
inspection, pausing and cleanup when the flag is disabled.

## Editor

Models use the shared ConfigEditor object list with warehouse, primary-key,
extraction and sync-count columns. Single-model editing retains its custom SQL
editor and preview. Clone opens that editor as a new model with copied settings.

One field-list form follows SyncEditor: Name, Model, Destination, scheduling,
Stream, then stream-specific settings. The stream registry initially supports
Google Ads audiences. There is no wizard, intermediate save, warehouse preview or
Google preflight in this form. Selecting a model loads only column metadata for
searchable identifier/consent selectors, retaining saved mappings if inspection
fails. Save returns to the sync list (or opens logs with Run after save) and
writes `ConfigurationObjectLink.data` once;
the server still enforces workspace permissions and structural configuration rules.

Audience settings select a new managed audience or an existing audience ID.
Managed audiences support snapshot-diff mirror or full replacement. Existing
audiences support upsert with explicit removals, or full replacement with explicit
exclusive-management confirmation. Map email and/or phone, raw or SHA-256.
Optional consent columns default to GRANTED when unmapped. Runtime validates data
and provider access; permanent row errors fail immediately.

The runner creates managed audiences during their first run. Generated identity
and durable creation intent live in `source_state`, not configuration entities.
Uncertain submissions are discovered by the saved random marker on subsequent runs;
they never authorize duplicate creation. Delivery settings lock once execution or
provisioning starts; name, pause and schedule remain editable.

Empty schedule means manual-only execution. Syncctl manages schedules and status
refresh attempts while enabled. Run now opens the separate run logs page;
`/reverse-syncs/tasks` shows history and `/reverse-syncs/logs` shows one attempt.
Logs expose lifecycle and delivery summaries, not rows, identifiers or receipts.

## Existing sync migration

This explicit one-time migration preserves existing syncs and state. It does not
call Google or reset any audience, checkpoint, acknowledged membership, pending
receipt, artifact pointer, task history or target ownership. Ready legacy links
retain their delivery JSON/revision; only their managed-audience evidence moves
from `reverse-google-audience` into `source_state`. Incomplete setup settings move
from `reverse-sync-setup` into link data, retaining any saved creation marker/phase.
The old entities are removed atomically only after their evidence is preserved.

1. Back up the database and retain existing object-storage artifacts.
2. Pause affected syncs and drain all running workers. Stop old console mutation
   traffic and prevent syncctl from launching workers during the cutover. WAITING
   delivery state is retained; do not reset/cancel it to run this migration.
3. Using the new checkout and the intended database, run from `webapps/console`:
   `pnpm manage migrate-reverse-sync-settings --workspace <id> --apply`.
4. Deploy matching console and runner code before resuming traffic/syncs. There is
   no mixed-version fallback to configuration entities. Verify preserved audience
   IDs and pending runs, then re-enable the syncs you paused.

The command requires a workspace and explicit `--apply`, refuses enabled legacy
syncs/running workers, and rolls back on ambiguous or conflicting evidence. A
second run is a no-op. Unlinked abandoned legacy setup records are not touched.
No new Prisma tables or columns are needed. No live migration runs on page load,
Save, or deployment. This is separate from the earlier object-storage cutover.

## Verification

Console integration tests cover save/edit access, migration rollback and exact
delivery-revision/state preservation. Runner tests cover first-run creation,
uncertain responses, discovery and OAuth failures using isolated databases and
mocked provider requests. Deployment remains manual; runner and console are separate.
