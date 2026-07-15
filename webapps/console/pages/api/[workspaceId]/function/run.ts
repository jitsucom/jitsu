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
        functionId: z.string(),
        functionName: z.string().optional(),
        code: z.string(),
        event: z.any(),
        variables: z.any(),
        store: z.any(),
        userAgent: z.string().optional(),
      }),
      result: resultType,
    },
    handle: async ({ user, query, body }) => {
      return debugService().runFunction(user, query.workspaceId, {
        functionId: body.functionId,
        functionName: body.functionName,
        code: body.code,
        event: body.event,
        variables: body.variables,
        store: body.store,
        userAgent: body.userAgent,
      });
    },
  },
};

export default nextJsApiHandler(api);
