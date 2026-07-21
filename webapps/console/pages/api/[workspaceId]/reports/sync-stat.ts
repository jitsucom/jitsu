import { z } from "zod";
import { createRoute, getWorkspace } from "../../../../lib/api";
import { reportsService } from "../../../../lib/server/route-services";

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      start: z.coerce.date().optional(),
      end: z.coerce.date().optional(),
      granularity: z.enum(["day", "hour"]).optional().default("day"),
    }),
    result: z.any(),
  })
  .handler(async ({ user, query }) => {
    // getWorkspace resolves slugs too — the UI calls this route by workspace slug.
    const workspace = await getWorkspace(query.workspaceId);
    return reportsService().syncStat(user, workspace.id, { start: query.start, end: query.end });
  })
  .toNextApiHandler();
