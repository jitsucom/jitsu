import { z } from "zod";
import type { ReverseEditorOptions, ReverseStreamEditor } from "@jitsu/protocols/reverse-etl-editor";
import { resolveStreamEditor } from "@jitsu/destination-functions/src/reverse-etl/editor";
import { ObjectMappings, WarehouseColumn } from "@jitsu/warehouse-query/src/schema";

export const MappingSuggestionRequest = z
  .object({
    modelId: z.string().min(1),
    destinationId: z.string().min(1),
    stream: z.string().min(1),
    mode: z.enum(["upsert", "mirror"]),
    mapping: z.record(z.string()),
    objectMappings: ObjectMappings.optional(),
    streamOptions: z.record(z.unknown()),
  })
  .strict();

const Candidate = z.object({
  key: z.string(),
  column: z.string(),
  format: z.enum(["raw", "sha256"]).optional(),
  probability: z.number().min(0).max(1),
});
export const MappingSuggestions = z.object({
  columns: z.array(WarehouseColumn),
  suggestions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      confidence: z.number().min(0).max(1),
      noMatch: z.boolean(),
      // An initial selection in the review dialog, never an automatic form change.
      recommended: Candidate.nullable(),
      alternatives: z.array(Candidate),
    })
  ),
});
export type MappingSuggestions = z.infer<typeof MappingSuggestions>;
export type MappingCandidate = z.infer<typeof Candidate>;

/** Only concrete mapping controls participate; never suggest defaults, selectors, targets, or payload identity maps. */
export function mappingTargets(stream: ReverseStreamEditor, options: ReverseEditorOptions) {
  const resolved = resolveStreamEditor(stream, options);
  return [...resolved.required, ...resolved.alternativeFields, ...resolved.optional].flatMap(field => {
    if (field.isHidden || field.configured) return [];
    if (field.editor === "mapping" && Object.hasOwn(options.objectMappings ?? {}, field.field)) return [];
    const variants =
      field.editor === "mapping"
        ? [{ key: field.field }]
        : field.editor === "identifier"
        ? [
            { key: field.raw, format: "raw" as const },
            { key: field.hashed, format: "sha256" as const },
          ]
        : [];
    return variants.length
      ? [
          {
            id: field.key,
            label: field.name ?? variants[0].key,
            documentation: field.documentation,
            requirement: field.requirement,
            required: field.isRequired,
            variants,
          },
        ]
      : [];
  });
}

/** Re-check against the current form: one variant per logical field, existing values always win. */
export function applyMappingSuggestions(
  stream: ReverseStreamEditor,
  options: ReverseEditorOptions,
  columns: WarehouseColumn[],
  selections: MappingCandidate[]
) {
  const next = { ...options.mapping };
  for (const target of mappingTargets(stream, options)) {
    const selected = selections.filter(
      candidate =>
        target.variants.some(variant => variant.key === candidate.key) &&
        columns.some(column => column.name === candidate.column)
    );
    if (selected.length === 1) next[selected[0].key] = selected[0].column;
  }
  return next;
}
