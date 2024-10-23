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
  error: z
    .object({ name: z.string(), message: z.string(), stack: z.string().optional(), retryPolicy: z.any().optional() })
    .optional(),
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
        events: z.array(z.any()),
        config: z.any(),
        store: z.any(),
        userAgent: z.string().optional(),
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
      const rotorAuthKey = process.env.ROTOR_AUTH_KEY;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (rotorAuthKey) {
        headers["Authorization"] = `Bearer ${rotorAuthKey}`;
      }

      const res = await rpc(rotorURL + "/profileudfrun", {
        method: "POST",
        body: {
          ...body,
          workspaceId,
        },
        headers,
      });
      return resultType.parse(res);
    },
  },
};

export default nextJsApiHandler(api);
