import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { getServerEnv } from "../../../../lib/server/serverEnv";
import { nangoConfig } from "../../../../lib/server/oauth/nango-config";
import { authorizeReverseRunner, readReverseGoogleToken } from "../../../../lib/server/reverse-sync-oauth";
import { isReadOnly } from "../../../../lib/server/maintenance";

/** Service-to-service OAuth for an admitted sync, not a general Nango credential proxy. */
export default createRoute()
  .GET({
    auth: false,
    query: z
      .object({
        syncId: z.string().min(1).max(128),
        workspaceId: z.string().min(1).max(128),
        configRevision: z.string().regex(/^[a-f0-9]{64}$/),
        refreshTaskId: z.string().min(1).max(512).optional(),
      })
      .strict(),
  })
  .handler(async ({ req, res, query }) => {
    res.setHeader("Cache-Control", "no-store");
    if (!authorizeReverseRunner(req.headers.authorization, getServerEnv().SYNCCTL_AUTH_KEY)) {
      res.status(401).json({ error: "Authorization required" });
      return;
    }
    if (isReadOnly()) {
      res.status(503).json({ error: "Reverse sync OAuth unavailable in read-only mode" });
      return;
    }
    try {
      res.status(200).json(await readReverseGoogleToken(db.prisma(), query, nangoConfig));
    } catch {
      res.status(409).json({ error: "Reverse sync OAuth unavailable; verify configuration and authorization" });
    }
  })
  .toNextApiHandler();
