import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { getResourceJsonSchema } from "../../../lib/schema/json-schema";

export default createRoute()
  .GET({
    auth: false,
    query: z.object({ type: z.array(z.string()) }),
  })
  .handler(async ({ query }) => {
    const [type, subType] = query.type;
    return getResourceJsonSchema(type, subType);
  })
  .toNextApiHandler();
