import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { getServerLog } from "../../../../../lib/server/log";
import { ApiError } from "../../../../../lib/shared/errors";
import { getConfigObjectType, parseObject } from "../../../../../lib/schema/config-objects";
import { httpAgent, httpsAgent } from "../../../../../lib/server/http-agent";
import { getErrorMessage, requireDefined } from "juava";
import nodeFetch from "node-fetch-commonjs";

const log = getServerLog("test-connection");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb", // Set desired value here
    },
  },
};

export const api: Api = {
  url: inferUrl(__filename),
  POST: {
    types: {
      query: z.object({ type: z.string(), workspaceId: z.string() }),
      body: z.any(),
      result: z.any(),
    },
    auth: true,
    handle: async ({ user, body, query }) => {
      log.atDebug().log("POST", JSON.stringify({ body, query }, null, 2));
      const bulkerURLEnv = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
      const bulkerAuthKey = process.env.BULKER_AUTH_KEY ?? "";
      const isHttps = bulkerURLEnv.startsWith("https://");
      const { workspaceId, type } = query;
      await verifyAccess(user, workspaceId);

      const configObjectTypes = getConfigObjectType(type);
      const object = await configObjectTypes.inputFilter(parseObject(type, body), "create");
      const payload = JSON.stringify(object);
      log.atDebug().log("payload", payload);
      // Options object
      const options = {
        method: "POST",
        agent: (isHttps ? httpsAgent : httpAgent)(),
        headers: {
          "Content-Type": "application/json",
        },
        body: payload,
      };
      if (bulkerAuthKey) {
        options.headers["Authorization"] = `Bearer ${bulkerAuthKey}`;
      }
      try {
        const response = await nodeFetch(bulkerURLEnv + "/test", options);
        const json = await response.json();
        log.atInfo().log(`StatusCode: ${response.status} Response Body: ${JSON.stringify(json)}`);
        return json;
      } catch (e) {
        throw new ApiError(`failed to fetch bulker API: ${getErrorMessage(e)}`, {}, { status: 500 });
      }
    },
  },
};

export default nextJsApiHandler(api);
