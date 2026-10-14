import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { getServerEnv } from "../../../lib/server/serverEnv";
import { nangoConfig } from "../../../lib/server/oauth/nango-config";
import { assertModelsEnabled } from "../../../lib/server/reverse-etl-models";
import { createDestinationDraft, destinationDraftAccounts } from "../../../lib/server/destination-oauth-draft";
import { savedDestinationAccounts } from "../../../lib/server/destination-accounts";
import { AccountDiscoveryProvider, DestinationAccounts } from "../../../lib/schema/destination-accounts";

export const route = createRoute()
  .POST({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    body: z.discriminatedUnion("action", [
      z.object({ action: z.literal("prepare"), provider: AccountDiscoveryProvider }),
      z.object({
        action: z.literal("draft-accounts"),
        provider: AccountDiscoveryProvider,
        grant: z.string().min(1).max(4096),
        developerToken: z.string().trim().max(2048).optional(),
      }),
      z.object({
        action: z.literal("saved-accounts"),
        provider: AccountDiscoveryProvider,
        destinationId: z.string().min(1).max(256),
      }),
    ]),
    result: z.union([z.object({ destinationId: z.string(), grant: z.string() }), DestinationAccounts]),
  })
  .handler(async ({ user, query, body, res }) => {
    await verifyAccessWithRole(user, query.workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    const env = getServerEnv();
    if (body.action === "prepare") {
      if (body.provider === "microsoft-ads") await assertModelsEnabled(db.prisma(), query.workspaceId);
      return createDestinationDraft(query.workspaceId, user.internalId, body.provider, env.JWT_SECRET);
    }
    const developerToken =
      body.provider === "google-ads" ? env.GOOGLE_ADS_DEVELOPER_TOKEN : env.MICROSOFT_ADS_DEVELOPER_TOKEN;
    if (body.action === "saved-accounts")
      return savedDestinationAccounts(
        db.prisma(),
        query.workspaceId,
        body.destinationId,
        body.provider,
        nangoConfig,
        developerToken
      );
    return destinationDraftAccounts(
      db.prisma(),
      query.workspaceId,
      user.internalId,
      body.provider,
      body.grant,
      {
        secret: env.JWT_SECRET,
        nango: nangoConfig,
        developerToken,
      },
      body.developerToken || undefined
    );
  });
export default route.toNextApiHandler();
