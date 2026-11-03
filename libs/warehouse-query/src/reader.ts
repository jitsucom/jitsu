import type { ModelDefinition, PreviewResult, WarehouseColumn } from "./schema";
import type { CompositeCursor, SourceRecord, WarehouseReader } from "./types";
import { decodeDelete, keyCountColumn } from "./sql";
import { transformNestedObjects, transformNestedPreview, type NestedObjects } from "./nested-objects";

export const previewRowLimit = 100;
export const previewByteLimit = 2_000_000;
export const previewSizeError = "Preview exceeds 2 MB; select fewer or smaller columns";

/** Decode only warehouse-typed JSON, never arbitrary text columns. Nested numbers
 * intentionally use JS precision; scalar keys/cursors retain lossless decoding. */
export function decodeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  let overflow = false;
  try {
    return JSON.parse(value, (_key, decoded) => {
      if (typeof decoded === "number" && !Number.isFinite(decoded)) {
        overflow = true;
        throw new Error();
      }
      return decoded;
    });
  } catch {
    // Native SyntaxError messages can include source-row values.
    throw new Error(
      overflow
        ? "Warehouse JSON contains a number outside JavaScript's finite range; return it as a JSON string instead"
        : "Warehouse returned invalid JSON in a structured column"
    );
  }
}

/** Recognize exact numeric 0/1 without rounding decimal strings through Number. */
export function numericDeleteValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match || !(match[2] || match[3])) return value;
  const fraction = match[3] ?? "";
  const digits = (match[2] + fraction).replace(/^0+/, "");
  if (!digits) return false;
  const significant = digits.replace(/0+$/, "");
  if (
    match[1] !== "-" &&
    significant === "1" &&
    BigInt(match[4] ?? "0") + BigInt(digits.length - significant.length) === BigInt(fraction.length)
  )
    return true;
  return value;
}

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
  return {
    row: transformNestedObjects(record, model.nestedObjects),
    deleted: model.deleteColumn ? decodeDelete(record[model.deleteColumn]) : false,
    checkpoint,
  };
}

export function boundedPreview(columns: WarehouseColumn[], rows: Record<string, unknown>[]): PreviewResult {
  // Include incoming overflow rows too, even though they are not displayed.
  if (Buffer.byteLength(JSON.stringify(rows)) > previewByteLimit) throw new Error(previewSizeError);
  return { columns, rows: rows.slice(0, previewRowLimit), truncated: rows.length > previewRowLimit };
}

/** Preview and sample mapping fields using exactly the streaming payload transformation. */
export async function previewModelRows(
  reader: WarehouseReader,
  query: string,
  mode: NestedObjects = "leaveAsIs",
  signal?: AbortSignal
): Promise<PreviewResult> {
  const raw = await reader.preview(query, signal);
  const preview = transformNestedPreview(
    { ...raw, columns: raw.columns.map(c => ({ ...c, supportsDelete: reader.sql.supportsDeleteType(c.type) })) },
    mode
  );
  // Flattened names and JSON escaping may increase the result size.
  boundedPreview(preview.columns, preview.rows);
  return preview;
}
