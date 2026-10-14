import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { getServerEnv } from "../../../../lib/server/serverEnv";
import { nangoConfig } from "../../../../lib/server/oauth/nango-config";
import { assertModelsEnabled } from "../../../../lib/server/reverse-etl-models";
import { createMicrosoftDraft, microsoftDraftAccounts } from "../../../../lib/server/microsoft-ads-draft";

export const route = createRoute()
  .POST({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    body: z.discriminatedUnion("action", [
      z.object({ action: z.literal("prepare") }),
      z.object({
        action: z.literal("accounts"),
        grant: z.string().min(1).max(4096),
        developerToken: z.string().trim().max(2048).optional(),
      }),
    ]),
    result: z.union([
      z.object({ destinationId: z.string(), grant: z.string() }),
      z.object({
        options: z.array(z.object({ value: z.string(), label: z.string(), customerId: z.string().optional() })),
        truncated: z.boolean().optional(),
      }),
    ]),
  })
  .handler(async ({ user, query, body, res }) => {
    await verifyAccessWithRole(user, query.workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    const env = getServerEnv();
    if (body.action === "prepare") {
      await assertModelsEnabled(db.prisma(), query.workspaceId);
      return createMicrosoftDraft(query.workspaceId, user.internalId, env.JWT_SECRET);
    }
    return microsoftDraftAccounts(
      db.prisma(),
      query.workspaceId,
      user.internalId,
      body.grant,
      {
        secret: env.JWT_SECRET,
        nango: nangoConfig,
        developerToken: env.MICROSOFT_ADS_DEVELOPER_TOKEN,
      },
      body.developerToken || undefined
    );
  });
export default route.toNextApiHandler();
