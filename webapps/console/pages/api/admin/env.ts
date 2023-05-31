import { Api, nextJsApiHandler } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { assertDefined, assertTrue } from "juava";

export const api: Api = {
  GET: {
    auth: true,
    handle: async ({ user, req }) => {
      const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
      assertDefined(userProfile, "User profile not found");
      assertTrue(userProfile.admin, "Not enough permissions");
      return {
        env: process.env,
        headers: req.headers,
      };
    },
  },
};

export default nextJsApiHandler(api);
