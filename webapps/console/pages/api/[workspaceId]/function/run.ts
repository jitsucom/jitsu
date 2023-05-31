import { getServerLog } from "../../../../lib/server/log";
import { z } from "zod";
import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { requireDefined, rpc } from "juava";

const log = getServerLog("function-run");

export type logType = {
  message: string;
  level: string;
  timestamp: Date;
  type: string;
  data?: any;
};

const resultType = z.object({
  error: z.string().optional(),
  result: z.any(),
  store: z.record(z.any()),
  logs: z.array(z.any()),
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
