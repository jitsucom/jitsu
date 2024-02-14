import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { db } from "../../../../../lib/server/db";
import { z } from "zod";
import { getServerLog } from "../../../../../lib/server/log";
import { ApiError } from "../../../../../lib/shared/errors";
import { httpAgent, httpsAgent } from "../../../../../lib/server/http-agent";
import { getErrorMessage, requireDefined } from "juava";
import nodeFetch from "node-fetch-commonjs";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

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
      if (type.startsWith("incoming.")) {
        const source = await db
          .prisma()
          .configurationObject.findFirst({ where: { id: actorId, workspaceId: workspaceId } });
        if (!source) {
          throw new ApiError(`site doesn't belong to the current workspace`, {}, { status: 403 });
        }
      } else {
        const link = await db
          .prisma()
          .configurationObjectLink.findFirst({ where: { id: actorId, workspaceId: workspaceId } });
        if (!link) {
          throw new ApiError(`connection doesn't belong to the current workspace`, {}, { status: 403 });
        }
      }

      // Options object
      const options = {
        method: "GET",
        agent: (isHttps ? httpsAgent : httpAgent)(),
        headers: {},
      };
      if (bulkerAuthKey) {
        options.headers["Authorization"] = `Bearer ${bulkerAuthKey}`;
      }
      const start = req.query.start as string;
      const end = req.query.end as string;
      try {
        const response = await nodeFetch(
          `${bulkerURLEnv}/log/${type}/${actorId}?limit=${req.query.limit ?? 50}&maxBytes=4000000&start=${
            start ? dayjs(start, "YYYY-MM-DD").utc(true).unix() * 1000 : ""
          }&end=${end ? dayjs(end, "YYYY-MM-DD").utc(true).add(1, "d").unix() * 1000 : ""}&beforeId=${
            req.query.beforeId ?? ""
          }`,
          options
        );
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const json = await response.json();
        return json;
      } catch (e) {
        throw new ApiError(`failed to fetch bulker API: ${getErrorMessage(e)}`, {}, { status: 500 });
      }
    },
  },
};

export default nextJsApiHandler(api);
