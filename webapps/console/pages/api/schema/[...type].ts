import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { getConfigObjectType } from "../../../lib/schema/config-objects";
import zodToJsonSchema from "zod-to-json-schema";
import { getCoreDestinationType } from "../../../lib/schema/destinations";

export const BaseLinkType = z.object({ fromId: z.string(), toId: z.string() });

export default createRoute()
  .GET({
    auth: false,
    query: z.object({ type: z.array(z.string()) }),
  })
  .handler(async ({ query }) => {
    const [type, subType] = query.type;
    if (!type) {
      return {};
    }
    if (type === "link") {
      if (subType) {
        const opts = getCoreDestinationType(subType).connectionOptions;
        return zodToJsonSchema(BaseLinkType.merge(z.object({ data: opts })));
      } else {
        return zodToJsonSchema(BaseLinkType.merge(z.object({ data: z.any() })));
      }
    }
    const objectType = getConfigObjectType(type);
    const zodType = subType
      ? objectType.narrowSchema({ destinationType: subType }, objectType.schema)
      : objectType.schema;
    return zodToJsonSchema(zodType);
  })
  .toNextApiHandler();
