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
  property: z.string().optional(),
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
export type MappingSuggestionPatch = Pick<ReverseEditorOptions, "mapping" | "objectMappings">;

type MappingTarget = {
  id: string;
  label: string;
  documentation?: string;
  requirement?: string;
  required: boolean;
  object?: { key: string; name: string; description?: string; property: string };
  variants: Pick<MappingCandidate, "key" | "property" | "format">[];
};

/** Only concrete mapping controls participate; never suggest defaults, selectors, targets, or payload identity maps. */
export function mappingTargets(stream: ReverseStreamEditor, options: ReverseEditorOptions): MappingTarget[] {
  const resolved = resolveStreamEditor(stream, options);
  return [...resolved.required, ...resolved.alternativeFields, ...resolved.optional].flatMap<MappingTarget>(field => {
    if (field.isHidden) return [];
    if (field.editor === "mapping" && Object.hasOwn(options.objectMappings ?? {}, field.field)) {
      // Composition is opt-in. Even a configured object may have optional properties left to suggest.
      if (options.mapping[field.field]) return [];
      return (field.object?.properties ?? [])
        .filter(property => !options.objectMappings?.[field.field]?.[property.key])
        .map(property => ({
          id: `object:${JSON.stringify([field.field, property.key])}`,
          label: `${field.name ?? field.field} / ${property.name}`,
          documentation: property.documentation,
          requirement: field.requirement,
          required: !!property.required,
          object: {
            key: field.field,
            name: field.name ?? field.field,
            description: field.documentation,
            property: property.key,
          },
          variants: [{ key: field.field, property: property.key }],
        }));
    }
    if (field.configured) return [];
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
): MappingSuggestionPatch {
  const next: MappingSuggestionPatch = { mapping: { ...options.mapping } };
  for (const target of mappingTargets(stream, options)) {
    const selected = selections.filter(
      candidate =>
        target.variants.some(variant => variant.key === candidate.key && variant.property === candidate.property) &&
        columns.some(column => column.name === candidate.column)
    );
    if (selected.length !== 1) continue;
    const candidate = selected[0];
    if (candidate.property !== undefined) {
      const objects = next.objectMappings ?? options.objectMappings;
      next.objectMappings = {
        ...objects,
        [candidate.key]: { ...objects?.[candidate.key], [candidate.property]: candidate.column },
      };
    } else next.mapping[candidate.key] = candidate.column;
  }
  return next;
}
