import { Api, inferUrl, nextJsApiHandler } from "../../../../../lib/api";
import { z } from "zod";
import { eventsLogQuery, streamEventsLog } from "../../../../../lib/server/events-log-stream";

/**
 * Events log across every actor of the workspace. Each record carries `actorId`. See
 * `./[actorId].ts` for a single actor
 */
export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    types: {
      query: eventsLogQuery,
      result: z.any(),
    },
    streaming: true,
    auth: true,
    handle: async ({ user, res, query }) => {
      await streamEventsLog({ user, res, query });
    },
  },
};

export default nextJsApiHandler(api);
