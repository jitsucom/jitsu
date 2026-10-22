# Object composition

- Existing `mapping: { field: column }` remains unchanged, including object/JSON columns.
- Optional `objectMappings: { field: { property: column } }` composes literal properties from model columns.
- Whole-column mapping and composition are mutually exclusive for a destination field; changing the UI mode replaces it.
- Provider metadata declares fixed properties, required children and/or additional property names.
- Google conversions expose custom variables and session attributes; Meta conversions expose custom/app data.
- Arrays remain column mappings (including Meta app-data extinfo); this is not an array-item builder or expression language.
- Source values retain their types, including null and nested values. No implicit JSON parsing, coercion or dotted-path expansion.
- Empty optional compositions are omitted. Missing composed columns fail before submitting that row; provider schemas validate values.
- Shared requirement checks cover composition in the console and API; the runner checks allowed composition fields before writer creation.
- Composition is included in the existing delivery revision, payload hashing and durable prepared batches. No checkpoint/schema migration.
- Mapping suggestions leave composed fields untouched. They do not yet suggest individual object properties.
- Deploy the updated runner before enabling the console UI; older runners reject the new options. Deployment is manual.
