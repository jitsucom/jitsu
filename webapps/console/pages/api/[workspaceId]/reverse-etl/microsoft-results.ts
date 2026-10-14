import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { nangoConfig } from "../../../../lib/server/oauth/nango-config";
import { getServerEnv } from "../../../../lib/server/serverEnv";
import { reverseMicrosoftResults } from "../../../../lib/server/reverse-microsoft-results";
import { MicrosoftResults } from "@jitsu/destination-functions/src/functions/microsoft-ads/results-meta";

export const route = createRoute()
  .POST({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    body: z.object({ syncId: z.string().min(1), continuation: z.string().max(4096).optional() }),
    result: MicrosoftResults,
  })
  .handler(async ({ user, query, body, res }) => {
    await verifyAccessWithRole(user, query.workspaceId, "readEntities");
    res.setHeader("Cache-Control", "no-store");
    const env = getServerEnv();
    return reverseMicrosoftResults(db.prisma(), query.workspaceId, body.syncId, body.continuation, {
      nango: nangoConfig,
      developerToken: env.MICROSOFT_ADS_DEVELOPER_TOKEN,
      secret: env.JWT_SECRET,
    });
  });
export default route.toNextApiHandler();
