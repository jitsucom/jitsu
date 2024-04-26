import { createRoute, verifyAdmin } from "../../../lib/api";
import { getLog, stopwatch } from "juava";
import { clickhouse } from "../../../lib/server/clickhouse";
import dayjs from "dayjs";

export const log = getLog("events-log-trim");

export default createRoute()
  .GET({
    auth: true,
    streaming: true,
  })
  .handler(async ({ res, user }) => {
    await verifyAdmin(user);
    log.atInfo().log(`Trimming events log`);
    const metricsSchema =
      process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";
    const clickhouseCluster = process.env.CLICKHOUSE_CLUSTER || "jitsu_cluster";
    const eventsLogSize = process.env.EVENTS_LOG_SIZE ? parseInt(process.env.EVENTS_LOG_SIZE) : 200000;
    const statQuery: string = `select actorId, type, timestamp
                           from (select actorId,
                                        type,
                                        timestamp,
                                        row_number() OVER (PARTITION BY actorId, type ORDER BY timestamp desc) rn
                                 from ${metricsSchema}.events_log
                                 where timestamp > now() - interval 1 day and xor(level = 'error', {withoutErrors:UInt8})) rows
                           where rn = {eventsLogSize:UInt32}`;
    const deleteQuery: string = `delete
                             from ${metricsSchema}.events_log
                             where actorId = {actorId:String}
                               and
                                 type = {type :String}
                               and xor(level = 'error', {withoutErrors:UInt8})
                               and
                                 timestamp
                                 < {timestamp :DateTime64};`;
    const dropPartitionQuery: string = `alter table ${metricsSchema}.events_log on cluster ${clickhouseCluster} drop partition {partition:String}`;
    const result: any[] = [];
    for (const trimErrors of [false, true]) {
      const sw = stopwatch();
      const chResult = (await (
        await clickhouse.query({
          query: statQuery,
          query_params: {
            eventsLogSize: eventsLogSize,
            withoutErrors: !trimErrors,
          },
          clickhouse_settings: {
            wait_end_of_query: 1,
          },
        })
      ).json()) as any;
      log
        .atInfo()
        .log(
          `Trimming ${trimErrors ? "error level" : "non-error levels"} for ${
            chResult.data.length
          } actors. (Loaded in ${sw.elapsedPretty()})`
        );
      for (const row of chResult.data) {
        const actorId = row.actorId;
        const type = row.type;
        const timestamp = row.timestamp;
        try {
          const cr = await clickhouse.command({
            query: deleteQuery,
            query_params: {
              actorId: actorId,
              type: type,
              withoutErrors: !trimErrors,
              timestamp: timestamp,
            },
            clickhouse_settings: {
              wait_end_of_query: 0,
              enable_lightweight_delete: 1,
            },
          });
          result.push({ ...row, trimErrors });
          log
            .atInfo()
            .log(`Trimmed ${trimErrors ? "error level" : "non-error levels"} for ${actorId} ${type} ${timestamp}`);
        } catch (e: any) {
          result.push({ ...row, errors: trimErrors, error: e.message });
          log
            .atError()
            .withCause(e)
            .log(
              `Failed to trim ${trimErrors ? "error level" : "non-error levels"} for ${actorId} ${type} ${timestamp}`
            );
        }
      }
    }
    const oldPartition = dayjs().subtract(2, "month").format("YYYYMM");
    try {
      await clickhouse.command({
        query: dropPartitionQuery,
        query_params: {
          partition: oldPartition,
        },
      });
      log.atInfo().log(`Deleted partition ${oldPartition}`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to delete partition ${oldPartition}`);
    }
    res.json(result);
  })
  .toNextApiHandler();
export const config = {
  maxDuration: 300, //5 mins
};
