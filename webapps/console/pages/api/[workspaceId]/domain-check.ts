import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../lib/api";
import { getServerLog } from "../../../lib/server/log";

import { z } from "zod";
import { isDomainAvailable } from "../../../lib/server/custom-domains";

const log = getServerLog("custom-domains");

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({
        workspaceId: z.string(),
        domain: z.string(),
      }),
      result: z.object({
        available: z.boolean(),
      }),
    },
    handle: async ({ user, query }) => {
      await verifyAccess(user, query.workspaceId);
      const domainAvailability = await isDomainAvailable(query.domain, query.workspaceId);
      if (!domainAvailability.available) {
        log
          .atWarn()
          .log(
            `Domain '${query.domain}' can't be added to workspace ${query.workspaceId}. It is used by ${domainAvailability.usedInWorkspace}`
          );
        return { available: false };
      }
      return { available: true };
    },
  },
};

export default nextJsApiHandler(api);
