import type { ReverseEditorOptions } from "@jitsu/protocols/reverse-etl-editor";

type Mappings = Pick<ReverseEditorOptions, "mapping" | "objectMappings">;

/** Shared by extraction, mirror preflight and delivery. Property names are literal, never evaluated paths. */
export function mapReverseRow(row: Record<string, unknown>, options: Mappings): Record<string, unknown> {
  const get = (column: string) => {
    if (!Object.hasOwn(row, column)) throw new Error("A mapped model column is missing from the source row");
    return row[column];
  };
  const entries = Object.entries(options.mapping).map(
    ([field, column]) => [field, Object.hasOwn(row, column) ? row[column] : undefined] as const
  );
  for (const [field, properties] of Object.entries(options.objectMappings ?? {})) {
    if (Object.hasOwn(options.mapping, field)) throw new Error("Choose either a model column or object composition");
    // An untouched optional composition is not an empty provider object.
    if (Object.keys(properties).length) {
      entries.push([field, Object.fromEntries(Object.entries(properties).map(([key, column]) => [key, get(column)]))]);
    }
  }
  return Object.fromEntries(entries);
}

export function mappedColumns(options: Mappings): string[] {
  return [...Object.values(options.mapping), ...Object.values(options.objectMappings ?? {}).flatMap(Object.values)];
}
