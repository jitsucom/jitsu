import type { ModelDefinition, PreviewResult, WarehouseColumn } from "./schema";
import type { CompositeCursor, SourceRecord } from "./types";
import { decodeDelete, keyCountColumn } from "./sql";

export const previewRowLimit = 100;
export const previewByteLimit = 2_000_000;
export const previewSizeError = "Preview exceeds 2 MB; select fewer or smaller columns";

export function decodeRecord(model: ModelDefinition, record: Record<string, unknown>): SourceRecord {
  if (String(record[keyCountColumn]) !== "1") throw new Error("Model query contains duplicate primary keys");
  delete record[keyCountColumn];
  const key = model.primaryKey.map(name => {
    const value = record[name];
    if (value === null || value === undefined || !["string", "number", "boolean"].includes(typeof value)) {
      throw new Error(`Primary-key column '${name}' must contain non-null scalar values`);
    }
    return String(value);
  });
  let checkpoint: CompositeCursor | undefined;
  if (model.cursor) {
    const value = record[model.cursor.column];
    if (value === null || value === undefined || !["string", "number"].includes(typeof value)) {
      throw new Error("Cursor column must contain non-null scalar values");
    }
    checkpoint = { value: String(value), primaryKeyValues: key };
  }
  return { row: record, deleted: model.deleteColumn ? decodeDelete(record[model.deleteColumn]) : false, checkpoint };
}

export function boundedPreview(columns: WarehouseColumn[], rows: Record<string, unknown>[]): PreviewResult {
  // Include incoming overflow rows too, even though they are not displayed.
  if (Buffer.byteLength(JSON.stringify(rows)) > previewByteLimit) throw new Error(previewSizeError);
  return { columns, rows: rows.slice(0, previewRowLimit), truncated: rows.length > previewRowLimit };
}
