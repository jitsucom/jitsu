# Warehouse query readers

`createWarehouseReader(config)` supplies database I/O and a pure `reader.sql`
(`WarehouseSqlDialect`) for `validateQuery`, `validateColumns`, and `compileModel`.
Use `getWarehouseSqlDialect(destinationType)` when validating without credentials
or a client. Composition keeps SQL policy independently testable and avoids
putting execution methods on a SQL-only consumer.

- `postgres.ts`: PostgreSQL connections, exact scalar decoding, and SQL rules.
- `clickhouse.ts`: ClickHouse connections, result formats, and SQL rules.
- `bigquery.ts`: GoogleSQL, service-account authentication, dry-run metadata and paginated query jobs.
- `snowflake.ts`: Snowflake SELECT dialect, key-pair authentication and streamed results.
- `redshift.ts`: Redshift SQL dialect, password/TLS connections and single-cursor extraction.
- `mysql.ts`: MySQL 8+ SQL dialect, password/TLS connections and prepared-query extraction.

Jitsu-provisioned ClickHouse is supported. The browser's masked config only
advertises capability; preview and runner execution use the existing server-held
tenant credentials. Native provisioning endpoints use HTTPS on port 8443, matching
the console SQL editor. Explicit HTTP(S) endpoints retain their configured ports.
Read-only query settings and credential masking remain unchanged.
- `sql.ts`: shared read-only AST checks, delimiter scanning, column invariants,
  and checkpoint/duplicate-key query construction; no warehouse-name branches.
- `reader.ts`: shared row decoding and preview bounds.
- `types.ts`: reader, dialect, and checkpoint contracts.

Each warehouse owns parsing, literal/comment rules, identifier quoting, key/cursor
types, parameter binding, and timestamp lookback syntax. New readers implement
`WarehouseReader` and provide a `WarehouseSqlDialect`; common planning can be
reused through `createSqlDialect`.

PostgreSQL `losslessTypes` preserves bigint, numeric, date, and timestamp text in
both direct queries and cursors. Exact values matter for stable keys, checkpoint
resumption, and destination payloads; JavaScript numbers and dates can lose
precision or change timezone interpretation.

Model saves validate every primary-key column's metadata, including full-query
and lookback models: keys must decode as strings, numbers, or booleans. PostgreSQL
uses a conservative scalar OID allowlist; ClickHouse accepts supported JSON scalar
types (including nullable/low-cardinality encodings). Structured/binary and unknown
types require an explicit SQL cast to a supported scalar, such as text/String.
Actual null or duplicate key values still fail the run immediately. Checkpoint
binding has a separate, stricter type check where keys are used as parameters.

Delete-column metadata is validated separately: boolean and numeric/text 0/1
representations are supported, while structured, binary, date/time and other
incompatible types need an explicit boolean SQL expression. Console previews
annotate compatible columns for the picker using the same warehouse-owned rule.
Type compatibility is not a value guarantee: runtime decoding still accepts only
true/false, numeric 0/1, exact strings "0"/"1", or null (keep); other values fail
immediately, including noncanonical decimal text or padded strings.

PostgreSQL previews use a materialized query (PostgreSQL 12+) to evaluate at most
101 source rows once. The database measures native text output for the first 100
rows and withholds their values if the combined size exceeds 2 MB; the 101st row
returns only a truncation marker, never its field values. A final JSON-size check
also bounds the displayed result after decoding. This protects console memory;
it does not cap memory used by the source query inside PostgreSQL.

ClickHouse currently accepts the portable SELECT subset recognized by the MySQL
grammar: [node-sql-parser's supported dialects](https://github.com/taozhi8833998/node-sql-parser#supported-database-sql-syntax)
do not include ClickHouse. This is a compatibility limit, not full ClickHouse SQL
support. A native parser can be evaluated separately. Never execute an unparsed
fallback. Parser checks are defense in depth; database read-only settings and
least-privilege warehouse credentials remain necessary.

ClickHouse extraction drains one query to a private temporary JSONL file before
yielding rows to the sync runner. Slow state-database writes therefore cannot
stall the warehouse HTTP response, and pagination never re-executes the model.
The file is limited to 512 MiB, has mode 0600 in a private directory, and is
deleted on completion, early return, cancellation or failure. It contains source
data: use ephemeral, access-restricted scratch storage (the runner mounts `/tmp`
as `emptyDir`, also removed when the Pod is deleted). This is not recovery state.
Select fewer columns or split the model if extraction exceeds the limit.

Streaming has a 30-second deadline for each outstanding network read and a
two-hour overall deadline, plus the caller's cancellation signal. Consumer work
between reads does not consume the network-read deadline. Preview and metadata
requests retain their existing 30-second limits.

## BigQuery

Use the existing BigQuery destination (`project`, `bqDataset`, `keyFile`). Only
service-account JSON keys are accepted; there is no application-default or
workload-identity fallback to Jitsu's own Google credentials. Grant the account
BigQuery Job User on the query project and Data Viewer on the source datasets.
No destination table-write permissions are required for Reverse ETL reads.

The dataset location is discovered automatically; an optional `location` overrides
discovery. `maximumBytesBilled` optionally caps each executed query's scan cost.
Without this setting normal BigQuery billing applies. Preview uses `LIMIT 101`,
which limits returned rows, **not bytes scanned**. Column inspection is a dry run.
See [query job configuration](https://cloud.google.com/bigquery/docs/reference/rest/v2/Job#JobConfigurationQuery).

Each extraction submits a single query job and paginates its results. New source
writes cannot change later pages of that job. INT64/NUMERIC/BIGNUMERIC remain
strings; TIMESTAMP preserves microseconds in UTC. Arrays and records are retained
as values, but cannot be primary keys/cursors.
Floating-point primary keys also require an explicit cast, because BigQuery
does not allow them in the window partitions used for duplicate detection.
Incremental cursors, timestamp lookback, duplicate-key validation, and delete flags
use the shared reader contract.

Preview is bounded to 100 rows/2 MB and individual REST response pages to 24 MiB.
Reads have 30-second deadlines; extraction is bounded to two hours. Cancellation
requests target this reader's jobs; server job timeouts remain a backstop if the
cancel request fails. Read-only SQL parsing is defense in depth; use least-privilege
service accounts. The supported dialect is node-sql-parser's GoogleSQL subset,
not arbitrary scripts, DDL, DML, or an unparsed-query fallback.

## Snowflake

Use the existing Snowflake destination with explicit `authenticationMethod: "key-pair"`,
`account`, `username`, `warehouse`, `database`, `defaultSchema`, `privateKey` and optional
`privateKeyPassphrase`. Password/interactive OAuth and private networking are not supported
by this reader yet. Only `parameters.role` is forwarded from additional parameters;
arbitrary driver options cannot override authentication, TLS, endpoint or timeouts.
Grant USAGE on the warehouse/database/schema and SELECT on source tables/views to a
read-only role. Parsing is defense in depth, not a substitute for restricted permissions.

The SDK streams one extraction result with backpressure, never re-runs OFFSET pages.
NUMBER values are strings, timestamps retain nanoseconds with UTC session timezone, and
structured values are returned as JSON text to avoid rounding nested numbers. Structured
keys/cursors require a SQL cast. Snowflake's parser-supported SELECT subset is accepted;
there is no unparsed fallback for unsupported syntax.

Preview retains at most 100 rows / 2 MB (plus the truncation marker); the SDK can receive
a larger individual row or transport chunk before the decoded-size guard rejects it.
Use projections appropriate for preview. Reads time out after 30 seconds; extraction
has a two-hour deadline and server-side statement timeout. Cancellation/close requests
cancel only this reader's statement and destroy its dedicated connection.

Run the opt-in read-only smoke test with `TEST_RETL_SNOWFLAKE` containing a JSON destination
configuration: `pnpm exec vitest run src/snowflake.live.test.ts`. The default suite mocks
the SDK and cannot certify real account permissions or SQL compatibility. Deploy the
new runner before console support; no state migration is necessary.

## Redshift

Use a Redshift destination with database password authentication, host, port (default
5439), database, username, password and defaultSchema. Provisioned clusters and
Serverless endpoints use the same direct SQL path. IAM credentials/Data API and
private-network provisioning are deferred. TLS certificate verification is always on.
The source-only configuration does not need an S3 bucket; creating ordinary ingestion
connections/syncs still requires one, and clearing a bucket used by those links is blocked.

Each operation has a dedicated read-only transaction. Extraction declares one cursor
and fetches it in bounded row batches, without re-running the source query for later
pages. Redshift materializes cursor results on the leader node: its cluster-specific
cursor size/resource limits still apply. Errors fail the run; there is no silent OFFSET
fallback or partial success. Large extracts may require a future UNLOAD/S3 path.
See https://docs.aws.amazon.com/redshift/latest/dg/declare.html.

BIGINT/DECIMAL and date/timestamps retain wire-text precision via the shared PG decoders;
SUPER/VARBYTE keys require explicit casts. Preview retains 100 rows / 2 MB after fetching
at most 101 rows. Transport can allocate a larger fetch before that check. Cancellation
closes the dedicated connection. Per-read timeout is 30 seconds and extraction deadline
is two hours. Restricted warehouse credentials remain required.

`TEST_RETL_REDSHIFT` accepts JSON destination credentials for the opt-in live test:
`pnpm exec vitest run src/redshift.live.test.ts`. It runs only literal SELECTs and a
read-only cursor, without creating tables. Mock tests are not a substitute for testing
the real Redshift cursor protocol. Deploy the updated runner before console.

## MySQL

Reuse a MySQL destination with host, port (3306), database, username and password.
MySQL 8.0+ is required for window functions; MariaDB and IAM authentication are not
supported yet. Grant SELECT only on source tables/views. Extraction uses one
read-only, repeatable-read transaction and one prepared query result. Consistent
snapshots apply to InnoDB, not nontransactional tables. The session uses UTC and
standard backslash string escaping, independent of the server's default SQL mode.

TLS is verified by default, including when `parameters.tls` is `preferred`: reads
never silently fall back to plaintext. Explicit `false` disables TLS (local tests),
and explicit `skip-verify` disables certificate verification (not recommended).
Verified TLS currently requires the certificate's DNS hostname, not an IP literal,
because the driver does not pass IP hosts to TLS identity verification correctly.
Other additional connection parameters are not forwarded. Custom CA/client
certificates, IAM and network provisioning are follow-ups.

BIGINT, DECIMAL and date/time values retain exact text; JSON is returned as text
to avoid rounding nested numbers. Checkpoints use typed, server-prepared bindings,
including repeated parameters in composite-key comparisons. FLOAT/DOUBLE, binary,
JSON and unknown key types require an explicit SQL cast. SELECT INTO, locking reads,
multiple statements and executable version comments are rejected. Use a read-only
account as the actual permission boundary.

The one result is drained to the same private, ephemeral, 512-MiB JSONL spool used
for ClickHouse. This prevents a slow destination from stalling the MySQL socket;
it is not persisted recovery state. Preview fetches at most 101 rows and checks
the decoded 2-MB limit afterward (large individual rows can allocate more before
rejection). Cancellation destroys the dedicated connection. Reads have a 30-second
timeout and extraction has a two-hour deadline.

Run `pnpm exec vitest run src/mysql.live.test.ts` with `TEST_RETL_MYSQL` containing
JSON destination credentials. These tests use literal SELECTs only. CI runs them
against disposable MySQL 8.4, and also runs Snowflake with the existing
`BULKER_TEST_SNOWFLAKE` secret. Redshift live tests require `BULKER_TEST_REDSHIFT`
(password authentication); IAM-only credentials cannot certify the direct reader.
Missing cloud credentials are reported explicitly, not treated as a live pass.
Deploy the updated runner before console; no state migration is needed.
