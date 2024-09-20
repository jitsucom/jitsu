import { createRoute, getUser, verifyAdmin } from "../../../lib/api";
import { stopwatch } from "juava";
import { clickhouse } from "../../../lib/server/clickhouse";
import dayjs from "dayjs";
import { getServerLog } from "../../../lib/server/log";

export const log = getServerLog("events-log-trim");

const localIps = ["127.0.0.1", "0:0:0:0:0:0:0:1", "::1", "::ffff:127.0.0.1"];

export default createRoute()
  .GET({
    streaming: true,
  })
  .handler(async ({ req, res }) => {
    //check if coming from localhost
    const isLocalhost = localIps.includes(req.socket.remoteAddress);
    if (!isLocalhost) {
      log.atInfo().log("Check admin user from: " + req.socket.remoteAddress);
      const user = await getUser(res, req);
      if (!user) {
        res.status(401).send({ error: "Authorization Required" });
        return;
      }
      await verifyAdmin(user);
    }
    log.atInfo().log(`Trimming events log`);
    const metricsSchema =
      process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";
    const clickhouseCluster = process.env.CLICKHOUSE_CLUSTER || "jitsu_cluster";
    const eventsLogSize = process.env.EVENTS_LOG_SIZE ? parseInt(process.env.EVENTS_LOG_SIZE) : 200000;
    // trim logs to eventsLogSize only after exceeding threshold
    const thresholdSize = Math.floor(eventsLogSize * 1.25);
    const actorsQuery: string = `select actorId, type, count(*) from ${metricsSchema}.events_log
                                 group by actorId, type
                                 having count(*) > ${thresholdSize}`;
    const statQuery: string = `select timestamp
                               from ${metricsSchema}.events_log
                               where actorId = {actorId:String} and type = {type:String} and xor(level = 'error', {withoutErrors:UInt8})
                               order by timestamp desc LIMIT 1 OFFSET ${eventsLogSize}`;
    const deleteQuery: string = `delete
                             from ${metricsSchema}.events_log
                             where actorId = {actorId:String}
                               and
                                 type = {type:String}
                               and xor(level = 'error', {withoutErrors:UInt8})
                               and
                                 timestamp
                                 < {timestamp :DateTime64};`;
    const dropPartitionQuery: string = `alter table ${metricsSchema}.events_log on cluster ${clickhouseCluster} drop partition {partition:String}`;
    const result: any[] = [];
    const sw = stopwatch();
    let actorsResult: any = {};
    try {
      actorsResult = (await (
        await clickhouse.query({
          query: actorsQuery,
          clickhouse_settings: {
            wait_end_of_query: 1,
          },
        })
      ).json()) as any;
    } catch (e) {
      log.atError().withCause(e).log(`Failed to load events log actors.`);
      throw e;
    }
    for (const trimErrors of [false, true]) {
      log
        .atInfo()
        .log(`Trimming ${trimErrors ? "error level" : "non-error levels"} for ${actorsResult.data.length} actors.`);
      const len = actorsResult.data.length;
      let i = 0;
      for (const row of actorsResult.data) {
        i++;
        const actorId = row.actorId;
        const type = row.type;
        let timestamp: any = undefined;
        try {
          const tsResult = (await (
            await clickhouse.query({
              query: statQuery,
              query_params: {
                actorId: actorId,
                type: type,
                withoutErrors: !trimErrors,
              },
              clickhouse_settings: {
                wait_end_of_query: 1,
              },
            })
          ).json()) as any;
          if (tsResult.data && tsResult.data.length > 0) {
            timestamp = tsResult.data[0].timestamp;
          }
        } catch (e: any) {
          log
            .atError()
            .withCause(e)
            .log(`${i} of ${len}. Failed to trim timestamp for ${actorId} ${type}. (trim errors: ${trimErrors})`);
          result.push({ ...row, errors: trimErrors, error: e.message });
        }
        if (timestamp) {
          const sw = stopwatch();
          log
            .atInfo()
            .log(
              `${i} of ${len}. Trimming ${
                trimErrors ? "error level" : "non-error levels"
              } for ${actorId} ${type} ${timestamp}`
            );
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
            result.push({ ...row, timestamp, trimErrors });
            log.atInfo().log(`Done at ${sw.elapsedPretty()}`);
          } catch (e: any) {
            result.push({ ...row, timestamp, errors: trimErrors, error: e.message });
            log
              .atError()
              .withCause(e)
              .log(
                `Failed to trim ${trimErrors ? "error level" : "non-error levels"} for ${actorId} ${type} ${timestamp}`
              );
          }
        }
      }
    }
    log.atInfo().log(`Trimmed ${result.length} logs in ${sw.elapsedPretty()}`);
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
    log.atInfo().log(`Completed in ${sw.elapsedPretty()}`);
    res.json(result);
  })
  .toNextApiHandler();
export const config = {
  maxDuration: 300, //10 mins
};
