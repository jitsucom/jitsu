import type { ModelDefinition, PreviewResult, WarehouseColumn } from "./schema";

export type NestedObjects = ModelDefinition["nestedObjects"];

/** Transform decoded payloads, never SQL identity/checkpoint values or arbitrary JSON-looking text. */
export function transformNestedObjects(
  row: Record<string, unknown>,
  mode: NestedObjects = "leaveAsIs"
): Record<string, unknown> {
  if (mode === "leaveAsIs") return row;
  if (mode === "stringify") {
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value !== null && typeof value === "object" ? JSON.stringify(value) : value,
      ])
    );
  }
  const entries = new Map<string, unknown>();
  const sourceNames = new Set(Object.keys(row));
  function visit(name: string, value: unknown, depth: number) {
    if (depth > 100) throw new Error("Nested objects exceed the flattening depth limit (100)");
    // Even a null/empty object must not hide a collision with a real SQL column.
    if (depth > 0 && sourceNames.has(name))
      throw new Error(
        "Nested object flattening produces conflicting field names; rename or alias the conflicting fields"
      );
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const children = Object.entries(value);
      if (children.length) {
        for (const [key, child] of children) visit(`${name}_${key}`, child, depth + 1);
        return;
      }
    }
    if (entries.has(name))
      throw new Error(
        "Nested object flattening produces conflicting field names; rename or alias the conflicting fields"
      );
    entries.set(name, value);
  }
  for (const [name, value] of Object.entries(row)) visit(name, value, 0);
  // Defining own properties also keeps __proto__/constructor keys safe.
  return Object.fromEntries(entries);
}

/** Flattened property names/types are sampled, not a promise about every future row. */
export function transformNestedPreview(preview: PreviewResult, mode: NestedObjects = "leaveAsIs"): PreviewResult {
  if (mode === "leaveAsIs") return preview;
  const rows = preview.rows.map(row => transformNestedObjects(row, mode));
  const columns: WarehouseColumn[] = [];
  const emitted = new Set<string>();
  const source = new Map(preview.columns.map(column => [column.name, column]));
  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (emitted.has(name)) continue;
      emitted.add(name);
      const original = source.get(name);
      const stringified =
        mode === "stringify" && preview.rows.some(r => r[name] !== null && typeof r[name] === "object");
      const types = new Set(
        rows.flatMap(r => {
          const value = r[name];
          return value == null ? [] : [Array.isArray(value) ? "array" : typeof value];
        })
      );
      columns.push(
        original && !stringified
          ? original
          : { name, type: stringified ? "string" : [...types].sort().join(" | ") || "unknown", supportsDelete: false }
      );
    }
  }
  return {
    ...preview,
    rows,
    columns: rows.length ? columns : preview.columns,
    sourceColumns: preview.columns,
  };
}
