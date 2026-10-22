import type {
  ReverseEditorAlternative,
  ReverseEditorField,
  ReverseEditorOptions,
  ReverseStreamEditor,
} from "@jitsu/protocols/reverse-etl-editor";

export const mappingKey = (key: string) => `mapping:${key}`;
export const settingKey = (key: string) => `setting:${key}`;
export function editorFieldKey(field: ReverseEditorField): string {
  if (field.editor === "mapping") return mappingKey(field.field);
  if (field.editor === "identifier") return mappingKey(field.raw);
  return settingKey(field.key ?? field.name!);
}
export function fieldConfigured(field: ReverseEditorField, options: ReverseEditorOptions): boolean {
  if (field.editor === "mapping") {
    if (options.mapping[field.field]?.trim()) return true;
    const properties = options.objectMappings?.[field.field];
    return (
      !!field.object &&
      !!properties &&
      Object.values(properties).some(value => !!value.trim()) &&
      (field.object.properties ?? []).filter(p => p.required).every(p => !!properties[p.key]?.trim())
    );
  }
  if (field.editor === "identifier")
    return !!(options.mapping[field.raw]?.trim() || options.mapping[field.hashed]?.trim());
  if (field.editor === "columns") return Object.keys(options.mapping).length > 0;
  if (field.editor === "notice") return false;
  return typeof field.value === "string"
    ? !!field.value.trim()
    : field.value != null && field.value !== false && (typeof field.value !== "number" || Number.isFinite(field.value));
}
export function fieldRequired(field: ReverseEditorField, options: ReverseEditorOptions): boolean {
  return typeof field.required === "function" ? field.required(options) : field.required === true;
}

/** Configuration only: no mutation, coercion or row validation. Hidden saved mappings remain discoverable. */
export function resolveStreamEditor(stream: ReverseStreamEditor, options: ReverseEditorOptions) {
  const fields = stream
    .fields(options)
    .map(field => ({
      ...field,
      key: editorFieldKey(field),
      isRequired: fieldRequired(field, options),
      isHidden: field.hidden?.(options) === true,
      configured: fieldConfigured(field, options),
    }))
    .filter(field => !field.isHidden || (field.configured && ["mapping", "identifier"].includes(field.editor)));
  const byKey = new Map(fields.map(field => [field.key, field]));
  const alternatives = (stream.alternatives?.(options) ?? [])
    .filter(group => !group.when || group.when(options))
    .map(group => ({
      ...group,
      configured: group.options.some(
        option =>
          option.fields.length > 0 &&
          option.fields.every(key => {
            const field = byKey.get(key);
            return field?.configured && !field.isHidden;
          })
      ),
    }));
  const alternativeKeys = new Set(alternatives.flatMap(group => group.options.flatMap(option => option.fields)));
  return {
    required: fields.filter(field => field.isRequired && !field.isHidden),
    alternatives,
    alternativeFields: fields.filter(field => !field.isRequired && !field.isHidden && alternativeKeys.has(field.key)),
    optional: fields.filter(field => field.isHidden || (!field.isRequired && !alternativeKeys.has(field.key))),
  };
}

/** Requirements known from configuration; conditional row branches remain the runner's responsibility. */
export function missingStreamRequirements(stream: ReverseStreamEditor, options: ReverseEditorOptions) {
  const resolved = resolveStreamEditor(stream, options);
  return {
    fields: resolved.required.filter(field => !field.configured && field.editor !== "notice"),
    alternatives: resolved.alternatives.filter(group => !group.configured && !group.condition),
  };
}

export function streamRequirementErrors(stream: ReverseStreamEditor, options: ReverseEditorOptions): string[] {
  const missing = missingStreamRequirements(stream, options);
  return [
    ...objectMappingErrors(stream, options),
    ...missing.fields.map(field => `${field.name ?? field.key} is required.`),
    ...missing.alternatives.map(group => `${group.title}: configure at least one complete option.`),
  ];
}

/** The provider owns which objects/properties may be composed; unknown fields must never reach a writer. */
export function objectMappingErrors(stream: ReverseStreamEditor, options: ReverseEditorOptions): string[] {
  const fields = stream.fields(options);
  const errors: string[] = [];
  for (const [key, properties] of Object.entries(options.objectMappings ?? {})) {
    const field = fields.find(f => f.editor === "mapping" && f.field === key);
    if (!field || field.editor !== "mapping" || !field.object) {
      errors.push("Object composition is not supported for a mapped field in this stream.");
      continue;
    }
    if (Object.hasOwn(options.mapping, key))
      errors.push(`${field.name}: choose a model column or composition, not both.`);
    if (
      !field.object.additionalProperties &&
      Object.keys(properties).some(p => !field.object!.properties?.some(f => f.key === p))
    )
      errors.push(`${field.name}: unknown object property.`);
    if (Object.keys(properties).length)
      for (const p of field.object.properties ?? []) {
        if (p.required && !properties[p.key]?.trim())
          errors.push(`${field.name}: ${p.name} is required when composing this object.`);
      }
  }
  return errors;
}

/** Decorate existing provider field descriptions by stable logical keys. */
export function withFieldRules(
  fields: ReverseEditorField[],
  rules: Record<string, Pick<ReverseEditorField, "required" | "hidden" | "requirement">>
): ReverseEditorField[] {
  return fields.map(field => ({ ...field, ...rules[editorFieldKey(field)] }));
}
export const alternative = (label: string, ...fields: string[]) => ({ label, fields: fields.map(mappingKey) });
export const contactAlternatives = (): ReverseEditorAlternative["options"] => [
  alternative("Email (raw or SHA-256)", "email"),
  alternative("Phone (raw or SHA-256)", "phone"),
  alternative(
    "Complete address: first name AND last name AND country AND postal code",
    "firstName",
    "lastName",
    "countryCode",
    "postalCode"
  ),
];
