import { z } from "zod";
import { createRoute, verifyAccess, getWorkspace } from "../../../../lib/api";
import { clickhouse } from "../../../../lib/server/clickhouse";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { getServerLog } from "../../../../lib/server/log";
import { Report } from "../../../../lib/shared/reporting";

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
      start: z.any().optional(),
      end: z.any().optional(),
      granularity: z.enum(["day", "hour"]).optional().default("day"),
    }),
    //result: z.any()
    result: Report.and(z.object({ queryMeta: z.any() })),
  })
  .handler(async ({ user, query }) => {
    const { workspaceId } = query;
    const workspace = await getWorkspace(workspaceId);
    await verifyAccess(user, workspace.id);
    const metricsSchema =
      process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";
    const start = query.start
      ? new Date(query.start).toISOString()
      : dayjs().subtract(1, "month").toDate().toISOString();
    const end = query.end ? new Date(query.end).toISOString() : new Date().toISOString();
    const sql = `
        select
            date_trunc({granularity:String}, timestamp) as period,
            connectionId,
            streamId,
            destinationId,
            status,
            sumMerge(events) as events,
            count(*) as "srcSize"
        from ${metricsSchema}.mv_metrics
        where 
            timestamp >= toDateTime({start:String}, 'UTC') and
            timestamp < toDateTime({end:String}, 'UTC') and 
            workspaceId = {workspace:String}
        group by period, connectionId, status, streamId, destinationId
        order by period desc, events desc;
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
    return {
      rows: chResult.data.map(({ period, ...rest }) => ({
        ...rest,
        period: toISOString(period),
        workspaceId: workspace.id,
      })),
    };
  })
  .toNextApiHandler();

function isoDateTOClickhouse(date: string): string {
  return date.replace("T", " ").replace("Z", "").split(".")[0];
}
