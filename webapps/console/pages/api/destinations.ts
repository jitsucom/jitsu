import { createRoute } from "../../lib/api";
import { coreDestinations, PropertyUI } from "../../lib/schema/destinations";
import omit from "lodash/omit";
import { renderToStaticMarkup } from "react-dom/server";
import { createDisplayName } from "../../lib/zod";
import { z } from "zod";

export default createRoute()
  .GET({ auth: false })
  .handler(async ({ req, res }) => {
    //set cors headers
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    return {
      destinations: coreDestinations.map(d => ({
        ...omit(d, "icon", "credentials", "credentialsUi", "connectionOptions", "deviceOptions", "description"),
        icon: d.icon && renderToStaticMarkup(d.icon as any),
        description:
          typeof d.description === "string"
            ? d.description
            : d.description && renderToStaticMarkup(d.description as any),
        //credentials: d.credentials.shape,
        configuration: Object.entries(d.credentials.shape)
          .map(([key, zd]) => {
            const defaultValue = zd instanceof z.ZodDefault ? zd._def.defaultValue() : undefined;
            const realType = getRealType(zd);
            const enumValues = realType instanceof z.ZodEnum ? Object.keys(realType.Values) : undefined;
            // zd.isOptional() treats params with default value as optional. We want only explicitly optional here
            const optional = isOptional(zd);
            let ui: PropertyUI = {};
            if (zd._def.description) {
              const meta = (zd._def.description as string).split("::");
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
                type: realType._def.typeName.replace("Zod", "").toLowerCase(),
              },
            ] as [string, any];
          })
          .reduce((acc, cur) => ({ ...acc, [cur[0]]: cur[1] }), {}),
      })),
    };
  })
  .toNextApiHandler();

function isOptional(zd: z.ZodTypeAny) {
  for (; zd; zd = zd._def.innerType) {
    if (zd instanceof z.ZodOptional) {
      return true;
    }
  }
  return false;
}

function getRealType(zd: z.ZodTypeAny) {
  for (; zd._def.innerType; ) {
    zd = zd._def.innerType;
  }
  return zd;
}
