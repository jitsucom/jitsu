import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { clickhouse } from "../../../../lib/server/clickhouse";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { getServerLog } from "../../../../lib/server/log";
import { requireDefined } from "juava";
import { db } from "../../../../lib/server/db";

dayjs.extend(utc);

const log = getServerLog("report-query");

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      destinationId: z.string().optional(),
      streamId: z.string().optional(),
      connectionId: z.string().optional(),
      statuses: z.string().optional().default("success,dropped,error"),
      start: z.string().optional(),
      end: z.string().optional(),
      groupBy: z.string().optional().default("workspaceId,status"),
      granularity: z.enum(["month", "day", "hour", "minute"]).optional().default("day"),
    }),
    result: z.any(),
  })
  .handler(async ({ user, query }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    const workspace = requireDefined(
      await db.prisma().workspace.findFirst({
        where: {
          OR: [
            {
              id: workspaceId,
            },
            {
              slug: workspaceId,
            },
          ],
          deleted: false,
        },
      }),
      `Workspace ${workspaceId} not found`
    );
    const startTs = query.start ? dayjs(query.start, "YYYY-MM-DD").utc(true).unix() : undefined;
    const endTs = query.end ? dayjs(query.end, "YYYY-MM-DD").add(1, "day").utc(true).unix() : undefined;
    const groupBy = query.groupBy ? query.groupBy.split(",") : [];
    const sql = `select date_trunc('${query.granularity || "day"}', timestamp) dt, ${
      groupBy.length > 0 ? groupBy.join(",") + "," : ""
    } sumMerge(events) events, uniqMerge(uniqEvents) uniq_events from newjitsu_metrics_test.mv_metrics
where workspaceId = '${workspace.id}'
${startTs ? ` and timestamp >= fromUnixTimestamp(${startTs})` : ""}
${endTs ? ` and timestamp < fromUnixTimestamp(${endTs})` : ""}
${query.destinationId ? ` and destinationId = '${query.destinationId}'` : ""}
${query.connectionId ? ` and connectionId = '${query.connectionId}'` : ""}
${query.streamId ? ` and streamId = '${query.streamId}'` : ""}
${
  query.statuses
    ? ` and status in (${query.statuses
        .split(",")
        .map(s => `'${s}'`)
        .join(",")})`
    : ""
}
group by all with totals
order by 1 desc`;

    log.atInfo().log(sql);

    const resultSet = await clickhouse.query({
      query: sql,
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    });
    return await resultSet.json();
  })
  .toNextApiHandler();
