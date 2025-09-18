import { z } from "zod";
import { createRoute, verifyAccess, getWorkspace } from "../../../../lib/api";
import { clickhouse, dateToClickhouse } from "../../../../lib/server/clickhouse";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { getServerLog } from "../../../../lib/server/log";
import { ActiveEventsReport, ActiveEventsReportRow } from "../../../../lib/shared/reporting";

dayjs.extend(utc);

const log = getServerLog("report-query");

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
    const workspace = await getWorkspace(workspaceId);
    await verifyAccess(user, workspace.id);
    const metricsSchema =
      process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";
    const end = query.end || new Date();
    const start = query.start || dayjs(end).subtract(1, "month").toDate();

    const sql = `
        select
            date_trunc({granularity:String}, timestamp) as period,
            sum(count) as "activeEvents",
            count(*) as "srcSize"
        from ${metricsSchema}.active_incoming_agg_view
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
          start: dateToClickhouse(start),
          end: dateToClickhouse(end),
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
