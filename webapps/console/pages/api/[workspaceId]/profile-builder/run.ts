import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler } from "../../../../lib/api";
import { debugService } from "../../../../lib/server/route-services";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb", // Set desired value here
    },
  },
};

const resultType = z.object({
  error: z
    .object({ name: z.string(), message: z.string(), stack: z.string().optional(), retryPolicy: z.any().optional() })
    .optional(),
  dropped: z.boolean().optional(),
  result: z.any().nullish(),
  store: z.record(z.any()),
  logs: z.array(z.any()),
  meta: z.any().nullish(),
  backend: z.string().optional(),
});

export type FunctionRunType = z.infer<typeof resultType>;

export const api: Api = {
  url: inferUrl(__filename),
  POST: {
    auth: true,
    types: {
      query: z.object({
        workspaceId: z.string(),
      }),
      body: z.object({
        id: z.string(),
        name: z.string().optional(),
        version: z.number().optional(),
        code: z.string(),
        events: z.array(z.any()),
        settings: z.any(),
        store: z.any(),
        userAgent: z.string().optional(),
      }),
      result: resultType,
    },
    handle: async ({ user, query, body }) => {
      return debugService().runProfileBuilder(user, query.workspaceId, {
        profileBuilderId: body.id,
        events: body.events,
        code: body.code,
        settings: body.settings,
        version: body.version,
        store: body.store,
        userAgent: body.userAgent,
      });
    },
  },
};

export default nextJsApiHandler(api);
