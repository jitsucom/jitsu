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
      start: z.any().optional(),
      end: z.any().optional(),
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
    const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || "newjitsu_metrics";
    const startTs = query.start ? new Date(query.start).toISOString() : undefined;
    const endTs = query.end ? new Date(query.end).toISOString() : undefined;
    const groupBy = query.groupBy ? query.groupBy.split(",") : [];
    const sql = `select formatDateTime(date_trunc('${query.granularity || "day"}', timestamp), '%Y-%m-%dT%H:%i:00.000Z') dt, ${
      groupBy.length > 0 ? groupBy.join(",") + "," : ""
    } sumMerge(events) events, uniqMerge(uniqEvents) uniq_events from ${metricsSchema}.mv_metrics
where workspaceId = '${workspace.id}'
${startTs ? ` and timestamp >= toDateTime('${isoDateTOClickhouse(startTs)}')` : ""}
${endTs ? ` and timestamp < toDateTime('${isoDateTOClickhouse(endTs)}')` : ""}
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

function isoDateTOClickhouse(date: string): string {
  return date.replace("T", " ").replace("Z", "").split(".")[0];
}
