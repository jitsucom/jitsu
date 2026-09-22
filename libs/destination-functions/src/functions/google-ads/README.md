# Google Ads destination

- `meta.ts` is browser-safe: credentials, stream schemas, defaults, mapping fields, and settings rules.
- `runtime.ts` binds the four Reverse ETL streams with host-injected OAuth, fetch, logs, and target state.
- `events.ts` retains the event-streaming destination and its existing normalization behavior.
- `audience/` owns Customer Match delivery, full replacement, provisioning, and state bindings.
- `conversions/` owns click conversions, call conversions, and conversion adjustments.
- `shared/` owns Reverse ETL identifier normalization; event behavior is intentionally not changed.
- Console renders metadata and enforces workspace access; Nango and Prisma stay in the host.
- Runner owns scheduling, source queries, snapshots, journals, and SQL-backed target-state operations.
- Reverse ETL consumers import these modules directly; serialized configuration, receipts, and state keys are unchanged.
- The separate `google-ads-destination.ts` event-streaming compatibility entry point is retained.
- Provisioning still records intent before submission and reconciles uncertain creates without replay. State updates use compare-and-set under the existing Kubernetes lease.

Browser and server catalogs are separate: `src/reverse-etl/catalog.ts` and `src/reverse-etl/runtime.ts`.
Import metadata without importing the runtime so Node-only code cannot enter console browser bundles.

See the [Reverse ETL implementation contract](REVERSE_ETL.md) for stream behavior, setup, and recovery.
