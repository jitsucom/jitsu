import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { getServerLog } from "../../../../../lib/server/log";
import { ApiError } from "../../../../../lib/shared/errors";
import { httpAgent, httpsAgent } from "../../../../../lib/server/http-agent";
import { getErrorMessage, requireDefined } from "juava";
import nodeFetch from "node-fetch-commonjs";

const log = getServerLog("test-connection");

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    types: {
      query: z.object({ type: z.string(), workspaceId: z.string(), actorId: z.string() }),
      result: z.any(),
    },
    auth: true,
    handle: async ({ user, req, query: { actorId, workspaceId, type } }) => {
      log.atDebug().log("GET", JSON.stringify({ actorId, workspaceId, type }, null, 2));
      const bulkerURLEnv = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
      const bulkerAuthKey = process.env.BULKER_AUTH_KEY ?? "";
      const isHttps = bulkerURLEnv.startsWith("https://");
      await verifyAccess(user, workspaceId);

      // Options object
      const options = {
        method: "GET",
        agent: (isHttps ? httpsAgent : httpAgent)(),
        headers: {},
      };
      if (bulkerAuthKey) {
        options.headers["Authorization"] = `Bearer ${bulkerAuthKey}`;
      }
      try {
        const response = await nodeFetch(
          `${bulkerURLEnv}/log/${type}/${actorId}?limit=${req.query.limit ?? 50}&start=${req.query.start ?? ""}&end=${
            req.query.end ?? ""
          }&beforeId=${req.query.beforeId ?? ""}`,
          options
        );
        const json = await response.json();
        log.atDebug().log(`StatusCode: ${response.status} Response Body: ${JSON.stringify(json)}`);
        return json;
      } catch (e) {
        throw new ApiError(`failed to fetch bulker API: ${getErrorMessage(e)}`, {}, { status: 500 });
      }
    },
  },
};

export default nextJsApiHandler(api);
