import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { nangoConfig } from "../../../../lib/server/oauth/nango-config";
import { getServerEnv } from "../../../../lib/server/serverEnv";
import { reverseMetaOptions } from "../../../../lib/server/reverse-meta-options";
import { reverseGoogleOptions } from "../../../../lib/server/reverse-google-options";

export const route = createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      destinationId: z.string().min(1),
      kind: z.enum(["audience", "conversion-action", "meta-account", "meta-audience"]),
      accountId: z.string().max(44).optional(),
      valueBased: z.enum(["true", "false"]).optional(),
    }),
    result: z.object({
      options: z.array(z.object({ value: z.string(), label: z.string() })),
      truncated: z.boolean().optional(),
    }),
  })
  .handler(async ({ user, query, res }) => {
    await verifyAccessWithRole(user, query.workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    if (query.kind === "meta-account" || query.kind === "meta-audience")
      return reverseMetaOptions(db.prisma(), query.workspaceId, query.destinationId, query.kind, {
        accountId: query.accountId,
        valueBased: query.valueBased === "true",
      });
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
