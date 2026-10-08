import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { reverseMetaResults } from "../../../../lib/server/reverse-meta-results";
import { MetaDestinationResults } from "@jitsu/destination-functions/src/functions/facebook/results-meta";

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({ workspaceId: z.string(), syncId: z.string().min(1) }),
    result: MetaDestinationResults.nullable(),
  })
  .handler(async ({ user, query, res }) => {
    await verifyAccessWithRole(user, query.workspaceId, "readEntities");
    res.setHeader("Cache-Control", "no-store");
    return reverseMetaResults(db.prisma(), query.workspaceId, query.syncId);
  });
export default route.toNextApiHandler();
