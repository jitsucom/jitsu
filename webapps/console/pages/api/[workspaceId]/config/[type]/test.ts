import { createRoute } from "../../../../../lib/api";
import { z } from "zod";
import { debugService } from "../../../../../lib/server/route-services";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
  },
};

export const route = createRoute()
  .POST({
    auth: true,
    query: z.object({ type: z.string(), workspaceId: z.string() }),
    body: z.any(),
    result: z.any(),
    summary: "Test connection",
    tags: ["config"],
  })
  .handler(async ({ user, body, query }) => {
    return debugService().testConnection(user, query.workspaceId, query.type, { config: body });
  });

export default route.toNextApiHandler();
