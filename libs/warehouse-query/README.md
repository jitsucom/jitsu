# Warehouse query readers

`createWarehouseReader(config)` supplies database I/O and a pure `reader.sql`
(`WarehouseSqlDialect`) for `validateQuery`, `validateColumns`, and `compileModel`.
Use `getWarehouseSqlDialect(destinationType)` when validating without credentials
or a client. Composition keeps SQL policy independently testable and avoids
putting execution methods on a SQL-only consumer.

- `postgres.ts`: PostgreSQL connections, exact scalar decoding, and SQL rules.
- `clickhouse.ts`: ClickHouse connections, result formats, and SQL rules.
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

ClickHouse readers validate all configured hosts and try each distinct endpoint
in configuration order on recognized transport failures. Metadata and data reads are pinned
to the same host per attempt; switching hosts reprobes metadata and recompiles the
query. With multiple hosts, each metadata probe and each data request's startup
has a deadline of at most five seconds (30 seconds divided by host count for
larger lists), leaving time for backup hosts within the console request deadline.
These reader-owned deadlines cover stalls both before and after response headers;
they are 30 seconds for a single host. Buffered previews keep the data deadline
until completion; streams clear it before delivering their first row, retaining
the SDK's existing 30-second idle timeout afterwards. Caller cancellation always
takes priority.

Buffered previews may restart before returning their result. Streaming failover
is allowed only before the first emitted row: once a row is delivered, errors
propagate for checkpoint-based recovery rather than mixing replicas or replaying
a delivered prefix. SQL, authentication, TLS, validation and result-limit errors
are never retried on another host; unclassified client errors also fail closed
rather than being identified by error-message text. Reader close cancels active requests and closes
all allocated clients. Hosts must serve the same logical dataset; this does not
provide cross-replica snapshot consistency or compensate for replication lag.
