import { z } from "zod";
import { createRoute, verifyAccess, getWorkspace } from "../../../../lib/api";
import { clickhouse } from "../../../../lib/server/clickhouse";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { getServerLog } from "../../../../lib/server/log";

dayjs.extend(utc);

const log = getServerLog("workspace-metrics");

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
    }),
    streaming: true,
  })
  .handler(async ({ user, query, res }) => {
    const { workspaceId } = query;
    const workspace = await getWorkspace(workspaceId);
    await verifyAccess(user, workspace.id);
    const metricsSchema =
      process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";
    const sql = `
        select
            connectionId,
            streamId,
            destinationId,
            functionId,
            status,
            sumMerge(events) as eventsCount
        from ${metricsSchema}.mv_metrics
        where
            timestamp >= date_trunc('day', now()) and
            workspaceId = {workspace:String}
        group by connectionId, status, streamId, destinationId, functionId
        order by connectionId desc`;
    try {
      const chResult = (await (
        await clickhouse.query({
          query: sql,
          query_params: {
            workspace: workspace.id,
          },
          clickhouse_settings: {
            wait_end_of_query: 1,
          },
        })
      ).json()) as any;

      res.writeHead(200, {
        "Content-Type": "text/plain",
      });
      res.write(`# HELP jitsu_connection_statuses Number of event status by connectionId, sourceId, destinationId, functionId
# TYPE jitsu_connection_statuses counter\n`);
      chResult.data.forEach((row: any) => {
        res.write(
          `jitsu_connection_statuses{connectionId="${row.connectionId}",sourceId="${row.streamId}",destinationId="${row.destinationId}",functionId="${row.functionId}",status="${row.status}"} ${row.eventsCount}\n`
        );
      });
    } catch (e) {
      res.writeHead(500, {
        "Content-Type": "text/plain",
      });
      log.atError().withCause(e).log(`Failed to fetch metrics for workspace ${workspaceId}`);
      res.write("Failed to fetch metrics");
    } finally {
      res.end();
    }
  })
  .toNextApiHandler();
