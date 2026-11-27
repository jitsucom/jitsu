import { createRoute, isPlatformAdmin } from "../../../lib/api";
import { z } from "zod";
import { requireDefined } from "juava";
import { db } from "../../../lib/server/db";

export default createRoute()
  .GET({ auth: true, result: z.object({ admin: z.boolean() }) })
  .handler(async ({ user }) => {
    const userModel = requireDefined(
      await db.prisma().userProfile.findUnique({ where: { id: user.internalId } }),
      `User ${user.internalId} does not exist`
    );
    // a limited key of an admin is not a platform admin here, as in /api/me
    return {
      admin: await isPlatformAdmin(user),
    };
  })
  .toNextApiHandler();
