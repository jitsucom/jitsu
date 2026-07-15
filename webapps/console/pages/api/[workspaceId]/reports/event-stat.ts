import { z } from "zod";
import { createRoute, getWorkspace } from "../../../../lib/api";
import { Report } from "../../../../lib/shared/reporting";
import { reportsService } from "../../../../lib/server/route-services";

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      start: z.any().optional(),
      end: z.any().optional(),
      granularity: z.enum(["day", "hour"]).optional().default("day"),
    }),
    result: Report.and(z.object({ queryMeta: z.any() })),
  })
  .handler(async ({ user, query }) => {
    // getWorkspace resolves slugs too — the UI calls this route by workspace slug.
    const workspace = await getWorkspace(query.workspaceId);
    return reportsService().eventStat(user, workspace.id, {
      start: query.start,
      end: query.end,
      granularity: query.granularity,
    });
  })
  .toNextApiHandler();
