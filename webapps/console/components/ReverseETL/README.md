# Reverse ETL console

The workspace feature flag is `reverse-etl`. The navigation includes Models,
Syncs, and All Logs. Existing objects remain reachable for inspection and
cleanup after the flag is disabled.

## Create a sync

1. Connect a read-only Postgres or HTTP(S) ClickHouse warehouse.
2. Create a model. Use the SQL editor and preview to select stable primary-key
   columns. Preview results expand immediately below the button.
3. Connect Google Ads with Data Manager OAuth and the customer account ID.
4. Create a reverse sync. Choose a new Jitsu-managed audience for full-query
   mirroring, or an existing audience ID for additions and explicit removals.
5. Map email and/or phone (raw or SHA-256). Consent mappings are optional; each
   unmapped field assumes `GRANTED`. Mapped columns must contain `GRANTED` for additions;
   denied, null or missing values fail the run. Confirm Customer Match terms;
   managed audiences also require explicit exclusive-management confirmation.
6. Validate the mapping and access, then save the disabled sync. For a managed
   audience, complete setup from its detail page. Enable and run when ready.

Setup is persisted before provider writes. If audience creation is unresolved,
check the same setup again; do not create another sync to retry it. Browser
recovery of a lost local-save response uses the original request and settings.
The server independently deduplicates that request and generates the sync ID.
Use **Discard unsaved request** to correct a rejected save. The server first
fences that request against late saves. If it already committed, the UI opens
the saved sync instead of discarding it. No Google audience is deleted.

## Operations

- Schedule changes are reconciled by syncctl into Kubernetes CronJobs.
- Empty schedule means manual only; recovery still runs while enabled.
- Pause stops new runs and automatic recovery. In-flight Google calls can
  finish. Cancel an active/waiting attempt separately when needed.
- `WAITING` is provider processing. `RESUMED` means a later attempt continued
  the logical run. Permanent row errors fail immediately; accepted effects and
  recovery evidence are preserved.
- Models, warehouses, account bindings and mappings referenced by saved syncs
  cannot be changed in place in this release. There is no force-success,
  skip-errors, state-reset or remote-audience deletion control.
- Managed audiences use 540-day membership and refresh unchanged members after
  30 days during normal runs. Existing audiences do not acquire a mirror baseline.

## Implementation and verification

The UI reuses the console shell, editor title, field layout, Monaco, Ant Design
and theme tokens. Dedicated workspace/role-scoped APIs own sync setup and
admission; generic link CRUD cannot bypass them. Setup intent is an internal
`ConfigurationObject`, not a new Prisma table. No billing logic is included.

Only task summaries and core lifecycle logs are returned to the UI. Provider
receipts, payloads, identifiers and recovery state are not exposed.

Tests: console unit tests, `reverse-syncs.test.ts`, `warehouse-models.test.ts`,
`reverse-sync-export.test.ts`, and destination-function tests. Provider calls
are mocked. Local browser QA uses a separate synthetic database and must not
submit audiences to a real Google account.

Deployment for this PR is manual; no `deploy:console` label. Console and runner
deployment remain separate.
