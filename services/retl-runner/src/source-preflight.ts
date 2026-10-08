import { serialize, deserialize } from "node:v8";
import type { DestinationServices } from "@jitsu/protocols/reverse-etl-runtime";
import type { WarehouseReader } from "@jitsu/warehouse-query";
import type { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { canonicalJson, recordKey } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { LocalIndex } from "./artifacts/local";
import { effects } from "./persistence/effects";
import { ensure, type Limits } from "./persistence/types";
import { MirrorRunError, validatePayloads } from "./mirror";

/** Disposable disk-backed source. No provider operation is allowed until the full source passes validation. */
export async function prepareSource(
  config: ReverseRunConfig,
  validation: Parameters<NonNullable<DestinationServices["validateSource"]>>[0],
  reader: WarehouseReader,
  signal: AbortSignal,
  limits: Limits
) {
  const index = await LocalIndex.create().catch(async error => {
    await reader.close().catch(() => undefined);
    throw error;
  });
  let read = 0,
    bytes = 0,
    entries = 0,
    pageRows = 0,
    pageBytes = 2,
    artifactBytes = 2;
  const flush = () => {
    if (!pageRows) return;
    ensure(artifactBytes <= limits.batchBytes, "Snapshot page exceeds byte limit");
    bytes += artifactBytes;
    ensure(entries <= limits.snapshotEntries && bytes <= limits.snapshotBytes, "Snapshot storage budget exceeded");
    pageRows = 0;
    pageBytes = 2;
    artifactBytes = 2;
  };
  let stage: "extraction" | "validation" | "snapshot" = "extraction";
  try {
    ensure(
      config.options.mode === "mirror" && !config.model.cursor && !config.model.deleteColumn,
      "Preflight requires a full mirror source"
    );
    ensure(Object.keys(config.options.mapping).length > 0, "Invalid mirror mapping");
    index.sql.exec("CREATE TABLE source_rows (sequence INTEGER PRIMARY KEY, key TEXT NOT NULL, row BLOB NOT NULL)");
    const put = index.sql.prepare("INSERT INTO source_rows VALUES (?,?,?)");
    const columns = new Set([...config.model.primaryKey, ...Object.values(config.options.mapping)]);
    for await (const record of reader.stream(config.model, undefined, signal)) {
      signal.throwIfAborted();
      read++;
      stage = "validation";
      const key = recordKey(config.model.primaryKey.map(column => record.row[column] as string | number | boolean));
      const row = Object.fromEntries([...columns].map(column => [column, record.row[column]]));
      const mapped = Object.fromEntries(
        Object.entries(config.options.mapping).map(([field, column]) => [field, row[column]])
      );
      const parsed = validation.projection.rowType.safeParse(mapped);
      ensure(parsed.success, "Source row failed mirror validation");
      const projected = effects(validation.projection.project(parsed.data), { allowEmpty: true });
      for (const value of projected) validatePayloads(value, validation.stream);
      const encoded = canonicalJson({
        key,
        identities: projected.map(({ identity, upsert, remove }) => ({ identity, upsert, remove })),
      });
      const size = Buffer.byteLength(encoded);
      ensure(size + 2 <= limits.batchBytes, "Snapshot source row exceeds byte budget");
      if (pageRows && (pageRows === Math.min(1000, limits.batchRecords) || pageBytes + size + 1 > limits.batchBytes))
        flush();
      entries += Math.max(1, projected.length);
      artifactBytes += Buffer.byteLength(JSON.stringify({ key, effects: projected })) + (pageRows ? 1 : 0);
      pageBytes += size + (pageRows ? 1 : 0);
      pageRows++;
      stage = "snapshot";
      index.append([{ key, effects: projected }]);
      put.run(read, key, serialize(row));
      stage = "extraction";
    }
    flush();
    signal.throwIfAborted();
    return {
      count: read,
      async *rows(sourceSignal: AbortSignal) {
        for (const value of index.sql.prepare("SELECT key,row FROM source_rows ORDER BY sequence").iterate()) {
          sourceSignal.throwIfAborted();
          yield {
            key: value.key as string,
            row: deserialize(value.row as Uint8Array) as Record<string, unknown>,
            deleted: false,
          };
        }
      },
      close: () => index.close(),
    };
  } catch (error) {
    await index.close();
    throw new MirrorRunError(stage, read, 0, error);
  } finally {
    await reader.close().catch(() => undefined);
  }
}
