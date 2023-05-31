import { Api, nextJsApiHandler } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { assertDefined, assertTrue } from "juava";
import { fastStore } from "../../../lib/server/fast-store";

export const api: Api = {
  GET: {
    auth: true,
    handle: async ({ user }) => {
      const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
      assertDefined(userProfile, "User profile not found");
      assertTrue(userProfile.admin, "Not enough permissions");
      await fastStore.fullRefresh();
      return { ok: true };
    },
  },
};

export default nextJsApiHandler(api);
