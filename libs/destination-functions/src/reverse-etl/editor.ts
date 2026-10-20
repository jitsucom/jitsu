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
  if (field.editor === "mapping") return !!options.mapping[field.field];
  if (field.editor === "identifier") return !!(options.mapping[field.raw] || options.mapping[field.hashed]);
  if (field.editor === "columns") return Object.keys(options.mapping).length > 0;
  if (field.editor === "notice") return false;
  return field.value !== undefined && field.value !== "" && field.value !== false;
}
export function fieldRequired(field: ReverseEditorField, options: ReverseEditorOptions): boolean {
  return typeof field.required === "function" ? field.required(options) : field.required === true;
}

/** Presentation only: no mutation, coercion or row validation. Hidden saved mappings remain discoverable. */
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
