import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../lib/api";
import { z } from "zod";
import { createJwt } from "../../../lib/server/ee";

export function isEEAvailable(): boolean {
  return !!process.env.EE_CONNECTION;
}

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      query: z.object({
        workspaceId: z.string(),
      }),
      result: z.object({
        jwt: z.string(),
        expiresAt: z.string(),
      }),
    },
    handle: async ({ user, query }) => {
      await verifyAccess(user, query.workspaceId);
      //issue short-lived (10m) token
      return createJwt(user.internalId, user.email, query.workspaceId, 60 * 10);
    },
  },
};

export default nextJsApiHandler(api);
