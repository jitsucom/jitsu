import { createRoute } from "../../../lib/api";
import { db, isUsingPgBouncer } from "../../../lib/server/db";
import { assertTrue } from "juava";
import { getServerEnv } from "../../../lib/server/serverEnv";

const serverEnv = getServerEnv();

export default createRoute()
  .GET({ auth: true })
  .handler(async ({ user }) => {
    const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });
    assertTrue(userProfile?.admin, "Not enough permissions");
    return {
      pgBouncer: isUsingPgBouncer(),
      isUsingSeparateAppDb: !!serverEnv.APP_DATABASE_URL,
    };
  })
  .toNextApiHandler();
