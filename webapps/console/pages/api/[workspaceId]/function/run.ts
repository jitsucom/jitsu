import { getServerLog } from "../../../../lib/server/log";
import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { requireDefined, rpc } from "juava";

const log = getServerLog("function-run");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb", // Set desired value here
    },
  },
};

const resultType = z.object({
  error: z.object({ name: z.string(), message: z.string(), stack: z.string().optional() }).optional(),
  dropped: z.boolean().optional(),
  result: z.any().nullish(),
  store: z.record(z.any()),
  logs: z.array(z.any()),
  meta: z.any().nullish(),
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
        config: z.any(),
        store: z.any(),
        workspaceId: z.string(),
      }),
      result: resultType,
    },
    handle: async ({ user, query, body }) => {
      const { workspaceId } = query;
      await verifyAccess(user, workspaceId);
      const rotorURL = requireDefined(
        process.env.ROTOR_URL,
        `env ROTOR_URL is not set. Rotor is required to run functions`
      );

      const res = await rpc(rotorURL + "/udfrun", {
        method: "POST",
        body: body,
        headers: {
          "Content-Type": "application/json",
        },
      });
      return resultType.parse(res);
    },
  },
};

export default nextJsApiHandler(api);
