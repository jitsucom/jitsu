import { Api, nextJsApiHandler } from "../../../../lib/api";
import * as emailTemplates from "../../../../lib/server/templates";
import { assertDefined, assertTrue } from "juava";
import { db } from "../../../../lib/server/db";

export const api: Api = {
  GET: {
    auth: true,
    handle: async ({ user }) => {
      const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
      assertDefined(userProfile, "User profile not found");
      assertTrue(userProfile.admin, "Not enough permissions");
      return {
        templates: Object.keys(emailTemplates),
      };
    },
  },
};

export default nextJsApiHandler(api);
