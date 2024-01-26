import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { clickhouse } from "../../../../lib/server/clickhouse";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { getServerLog } from "../../../../lib/server/log";
import { requireDefined } from "juava";
import { db } from "../../../../lib/server/db";
import { ActiveEventsReport, ActiveEventsReportRow } from "../../../../lib/shared/reporting";

dayjs.extend(utc);

const log = getServerLog("report-query");

async function getWorkspace(workspaceId: string | undefined) {
  return requireDefined(
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
}

function toISOString(period: string) {
  const [date, time] = period.split(" ");
  return `${date}T${time}Z`;
}

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      start: z.coerce.date().optional(),
      end: z.coerce.date().optional(),
      granularity: z.enum(["day", "hour"]).optional().default("day"),
    }),
    //result: z.any()
    result: ActiveEventsReport.and(z.object({ queryMeta: z.any() })),
  })
  .handler(async ({ user, query }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    const workspace = await getWorkspace(workspaceId);
    const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || "newjitsu_metrics";
    const end = query.end ? query.end.toISOString() : new Date().toISOString();
    const start = query.start ? query.start.toISOString() : dayjs(end).subtract(1, "month").toDate().toISOString();

    const sql = `
        select
            date_trunc({granularity:String}, timestamp) as period,
            uniqMerge(count) as "activeEvents",
            count(*) as "srcSize"
        from ${metricsSchema}.mv_active_incoming
        where 
            timestamp >= toDateTime({start:String}, 'UTC') and
            timestamp <= toDateTime({end:String}, 'UTC') and 
            workspaceId = {workspace:String}
        group by period
        order by period;
    `;

    const chResult = (await (
      await clickhouse.query({
        query: sql,
        query_params: {
          start: isoDateTOClickhouse(start),
          end: isoDateTOClickhouse(end),
          workspace: workspace.id,
          granularity: query.granularity,
        },
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      })
    ).json()) as any;

    console.log(chResult);
    const rows = chResult.data.map(({ period, ...rest }) =>
      ActiveEventsReportRow.parse({ period: toISOString(period), ...rest })
    );

    return {
      workspaceId: workspace.id,
      totalActiveEvents: rows.map(r => r.activeEvents).reduce((a, b) => a + b, 0),
      breakdown: rows,
    };
  })
  .toNextApiHandler();

function isoDateTOClickhouse(date: string): string {
  return date.replace("T", " ").replace("Z", "").split(".")[0];
}
