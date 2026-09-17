import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { CreateGoogleAudience, provisionGoogleAudience } from "../../../../lib/server/google-audiences";
import { nangoConfig } from "../../../../lib/server/oauth/nango-config";

export const route = createRoute()
  .POST({
    auth: true,
    mutates: true,
    query: z.object({ workspaceId: z.string() }),
    body: CreateGoogleAudience,
    result: z.object({
      id: z.string(),
      status: z.enum(["ready", "pending"]),
      audienceId: z.string().optional(),
      displayName: z.string(),
    }),
    summary: "Create or reconcile a Jitsu-managed Google audience",
    tags: ["reverse-etl"],
  })
  .handler(async ({ user, query: { workspaceId }, body, res }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    res.setHeader("Cache-Control", "no-store");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const cancel = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", cancel);
    try {
      return await provisionGoogleAudience(db.prisma(), workspaceId, body, nangoConfig, fetch, controller.signal);
    } finally {
      clearTimeout(timeout);
      res.off("close", cancel);
    }
  });

export default route.toNextApiHandler();
