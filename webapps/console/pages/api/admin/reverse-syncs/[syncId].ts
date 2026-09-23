import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createRoute } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { getServerEnv } from "../../../../lib/server/serverEnv";
import { readReverseSync } from "../../../../lib/server/reverse-sync-export";
import { isReadOnly } from "../../../../lib/server/maintenance";

/** Per-run admission, distinct from desired-state export. No billing side effects. */
export default createRoute()
  .GET({
    auth: false,
    query: z.object({
      syncId: z.string().min(1),
      workspaceId: z.string().min(1),
      refreshTaskId: z.string().min(1).max(512).optional(),
    }),
  })
  .handler(async ({ req, res, query }) => {
    const expected = Buffer.from(`Bearer ${getServerEnv().SYNCCTL_AUTH_KEY ?? ""}`);
    const actual = Buffer.from(req.headers.authorization ?? "");
    if (expected.length <= 7 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(401).json({ error: "Authorization required" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    if (isReadOnly()) {
      res.status(503).json({ error: "Reverse sync admission unavailable in read-only mode" });
      return;
    }
    try {
      const value = await db
        .prisma()
        .$transaction(
          tx => readReverseSync(tx, query.syncId, query.workspaceId, { refreshTaskId: query.refreshTaskId }),
          { isolationLevel: "RepeatableRead" }
        );
      if (!value) res.status(403).json({ error: "Reverse sync is missing or disabled" });
      else res.status(200).json(value);
    } catch {
      res.status(409).json({ error: "Reverse sync configuration is invalid" });
    }
  })
  .toNextApiHandler();
