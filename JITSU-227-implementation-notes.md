# JITSU-227: Models substrate

- First PR implements Models/preview and warehouse readers, not scheduled delivery or billing.
- Feature flag `reverse-etl` gates model APIs and navigation during rollout.
- Models use generic configuration CRUD/access/audit plumbing; no credential copies or model table migration.
- Postgres password auth and HTTP(S) ClickHouse only; unsupported connection modes are excluded explicitly.
- ClickHouse SQL accepts the parser's portable SELECT subset; unsupported syntax fails closed.
- Queries run read-only with server-side timeouts; users still need appropriately restricted warehouse credentials.
- Database window counts validate key uniqueness before incremental filtering (correctness first; can require a full scan).
- Composite checkpoints preserve raw numeric/timestamp values; Node never sorts database-collated keys.
- Reverse-sync schema is shared but link execution/creation stays unavailable until destination/runtime capability validation exists.
- Preview is limited to 100 rows/2 MB and requires edit permission because it can read warehouse data.
- Model reference writes/deletes use a short per-workspace DB lock, with warehouse validation outside the transaction and config rechecked inside it.
