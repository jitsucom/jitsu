import { createRoute } from "../../lib/api";
import { coreDestinations, PropertyUI } from "../../lib/schema/destinations";
import omit from "lodash/omit";
import { renderToStaticMarkup } from "react-dom/server";
import { createDisplayName, getZodDescription } from "../../lib/zod";
import { z } from "zod";

export default createRoute()
  .GET({ auth: false })
  .handler(async ({ req, res }) => {
    //set cors headers, allow access from all origins
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    return {
      destinations: coreDestinations.map(d => ({
        ...omit(
          d,
          "icon",
          "credentials",
          "credentialsUi",
          "connectionOptions",
          "deviceOptions",
          "description",
          "documentation"
        ),
        icon: d.icon && renderToStaticMarkup(d.icon as any),
        documentation:
          typeof d.documentation === "string"
            ? d.documentation
            : d.documentation && renderToStaticMarkup(d.documentation as any),
        description:
          typeof d.description === "string"
            ? d.description
            : d.description && renderToStaticMarkup(d.description as any),
        //credentials: d.credentials.shape,
        configuration: Object.entries(d.credentials.shape)
          .map(([key, zd]) => {
            const defaultValue = zd instanceof z.ZodDefault ? zd.def.defaultValue : undefined;
            const realType = getRealType(zd);
            const enumValues = realType instanceof z.ZodEnum ? Object.keys(realType.enum) : undefined;
            // zd.isOptional() treats params with default value as optional. We want only explicitly optional here
            const optional = isOptional(zd);
            let ui: PropertyUI = {};
            const description = getZodDescription(zd);
            if (description) {
              const meta = description.split("::");
              if (meta.length >= 2) {
                ui.displayName = meta[0];
                ui.documentation = meta[1];
              } else {
                ui.documentation = meta[0];
              }
            }
            ui = { ...ui, ...d.credentialsUi?.[key] };
            return [
              key,
              {
                name: ui?.displayName || createDisplayName(key),
                hidden: ui?.hidden,
                description: ui?.documentation,
                defaultValue: Array.isArray(defaultValue) ? defaultValue.join(",") : defaultValue,
                enumValues,
                required: !optional,
                type: zodTypeName(realType),
              },
            ] as [string, any];
          })
          .reduce((acc, cur) => ({ ...acc, [cur[0]]: cur[1] }), {}),
      })),
    };
  })
  .toNextApiHandler();

// Wrappers (optional, nullable, default, ...) keep the wrapped schema in `def.innerType`
function innerOf(zd: z.ZodType): z.ZodType | undefined {
  return (zd.def as { innerType?: z.ZodType }).innerType;
}

function isOptional(zd: z.ZodType) {
  for (let cur: z.ZodType | undefined = zd; cur; cur = innerOf(cur)) {
    if (cur instanceof z.ZodOptional) {
      return true;
    }
  }
  return false;
}

function getRealType(zd: z.ZodType) {
  for (let inner = innerOf(zd); inner; inner = innerOf(zd)) {
    zd = inner;
  }
  return zd;
}

// Public type names of the catalog: "string", "number", "boolean", "enum", ... (the v3 `typeName` without "Zod").
// zod 4 reports native enums as "enum" too, where v3 reported "nativeenum".
function zodTypeName(zd: z.ZodType): string {
  return zd.def.type;
}
