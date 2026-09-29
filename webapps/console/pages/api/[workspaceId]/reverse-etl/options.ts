import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { nangoConfig } from "../../../../lib/server/oauth/nango-config";
import { getServerEnv } from "../../../../lib/server/serverEnv";
import { reverseGoogleOptions } from "../../../../lib/server/reverse-google-options";

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      destinationId: z.string().min(1),
      kind: z.enum(["audience", "conversion-action"]),
    }),
    result: z.object({ options: z.array(z.object({ value: z.string(), label: z.string() })) }),
  })
  .handler(async ({ user, query, res }) => {
    await verifyAccessWithRole(user, query.workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    return reverseGoogleOptions(
      db.prisma(),
      query.workspaceId,
      query.destinationId,
      query.kind,
      nangoConfig,
      getServerEnv().GOOGLE_ADS_DEVELOPER_TOKEN
    );
  });
export default route.toNextApiHandler();
