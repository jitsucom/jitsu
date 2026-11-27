import { z } from "zod";

/**
 * JSON Schema (draft-07) for a zod schema, as used by the config editor forms, `/api/schema` and the MCP
 * `get_resource_schema` tool.
 *
 * Replaces `zod-to-json-schema`, which only understands zod 3 schemas: given a zod 4 schema it returns just
 * `{ $schema }`, so form fields and API/MCP resource schemas would silently lose all their properties.
 *
 * - `io: "input"` describes what a caller may send: fields with a default are not required.
 * - `unrepresentable: "any"` keeps types JSON Schema cannot express (e.g. functions) as `{}` instead of throwing.
 * - `override` keeps three things the way `zod-to-json-schema` wrote them, so the form editor and API/MCP consumers
 *   see the same schemas as before the zod 4 upgrade:
 *     1. `Date` is `{ type: "string", format: "date-time" }` (zod 4 cannot represent it and emits `{}`);
 *     2. objects that strip unknown keys are closed with `additionalProperties: false` (zod 4 leaves them open
 *        in input mode);
 *     3. `z.any()` / `z.unknown()` keys are not `required` (zod 3 inferred them as optional; zod 4 does not).
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, any> {
  return z.toJSONSchema(schema, {
    target: "draft-7",
    io: "input",
    unrepresentable: "any",
    override: ctx => {
      const def = (ctx.zodSchema as any)._zod.def;
      const json = ctx.jsonSchema as Record<string, any>;
      if (def.type === "date") {
        json.type = "string";
        json.format = "date-time";
      } else if (def.type === "object") {
        // a catchall means passthrough/loose (open on purpose); anything else strips or rejects unknown keys
        if (!def.catchall && json.additionalProperties === undefined) {
          json.additionalProperties = false;
        }
        if (Array.isArray(json.required)) {
          const required = json.required.filter(
            (key: string) => !["any", "unknown"].includes(def.shape?.[key]?.def?.type)
          );
          if (required.length) {
            json.required = required;
          } else {
            delete json.required;
          }
        }
      }
    },
  }) as Record<string, any>;
}
