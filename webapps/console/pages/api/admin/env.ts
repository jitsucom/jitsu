import { Api, nextJsApiHandler } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { assertDefined, assertTrue } from "juava";

function sortByKeys(dict: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b)));
}
export const api: Api = {
  GET: {
    auth: true,
    handle: async ({ user, req }) => {
      const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
      assertDefined(userProfile, "User profile not found");
      assertTrue(userProfile.admin, "Not enough permissions");
      return {
        env: sortByKeys(process.env),
        headers: sortByKeys(req.headers),
        nodeVersion: process.versions.node,
        remoteAddress: req.socket.remoteAddress,
      };
    },
  },
};

export default nextJsApiHandler(api);
