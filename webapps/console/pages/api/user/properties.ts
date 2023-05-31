import { createRoute } from "../../../lib/api";
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
    return {
      admin: !!userModel.admin,
    };
  })
  .toNextApiHandler();
