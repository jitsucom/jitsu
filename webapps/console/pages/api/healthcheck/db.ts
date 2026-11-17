import { createRoute, verifyAdmin } from "../../../lib/api";
import { isUsingPgBouncer } from "../../../lib/server/db";
import { getServerEnv } from "../../../lib/server/serverEnv";

const serverEnv = getServerEnv();

export default createRoute()
  .GET({ auth: true })
  .handler(async ({ user }) => {
    await verifyAdmin(user);
    return {
      pgBouncer: isUsingPgBouncer(),
      isUsingSeparateAppDb: !!serverEnv.APP_DATABASE_URL,
    };
  })
  .toNextApiHandler();
