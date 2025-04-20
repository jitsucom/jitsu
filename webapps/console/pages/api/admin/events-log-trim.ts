import { createRoute, getUser, verifyAdmin } from "../../../lib/api";
import { stopwatch } from "juava";
import { clickhouse } from "../../../lib/server/clickhouse";
import dayjs from "dayjs";
import { getServerLog } from "../../../lib/server/log";

const log = getServerLog("events-log-trim");

const localIps = ["127.0.0.1", "0:0:0:0:0:0:0:1", "::1", "::ffff:127.0.0.1"];

const largeLogSizeIds = ["cm3fnw0m50003bnco4pfy8p74", "cm3fnymo10003bjn24ejeygf3"];

type DeleteRequest = {
  actorId: string;
  type: string;
  withoutErrors: boolean;
  timestamp?: string;
  error?: string;
};

export default createRoute()
  .GET({
    streaming: true,
  })
  .handler(async ({ req, res }) => {
    //check if coming from localhost
    const isLocalhost = localIps.includes(req.socket.remoteAddress || "");
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
    const metricsCluster = process.env.CLICKHOUSE_METRICS_CLUSTER || process.env.CLICKHOUSE_CLUSTER;
    const onCluster = metricsCluster ? ` ON CLUSTER ${metricsCluster}` : "";
    const eventsLogSize = process.env.EVENTS_LOG_SIZE ? parseInt(process.env.EVENTS_LOG_SIZE) : 200000;
    const eventsLogSizeLarge = 20_000_000;

    // trim logs to eventsLogSize only after exceeding threshold
    const thresholdSize = Math.floor(eventsLogSize * 1.5);
    const actorsQuery: string = `select actorId, type, count(*) from ${metricsSchema}.events_log
                                 group by actorId, type
                                 having count(*) > ${thresholdSize}`;
    const statQuery: string = `select timestamp
                               from ${metricsSchema}.events_log
                               where actorId = {actorId:String} and type = {type:String} and xor(level = 'error', {withoutErrors:UInt8})
                               order by timestamp desc LIMIT 1 OFFSET ${eventsLogSize}`;
    const statQueryLarge: string = `select timestamp
                               from ${metricsSchema}.events_log
                               where actorId = {actorId:String} and type = {type:String} and xor(level = 'error', {withoutErrors:UInt8})
                               order by timestamp desc LIMIT 1 OFFSET ${eventsLogSizeLarge}`;
    const dropPartitionQuery: string = `alter table ${metricsSchema}.events_log ${onCluster} drop partition {partition:String}`;
    const oldPartition = dayjs().subtract(2, "month").format("YYYYMM");
    try {
      await clickhouse.command({
        query: dropPartitionQuery,
        query_params: {
          partition: oldPartition,
        },
        clickhouse_settings: {
          // allow to drop partitions up to 500gb in size
          max_partition_size_to_drop: 536870912000,
        },
      });
      log.atInfo().log(`Deleted partition ${oldPartition}`);
    } catch (e: any) {
      log.atDebug().withCause(e).log(`Failed to delete partition ${oldPartition}`);
    }
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
    const len = actorsResult.data.length;
    if (len === 0) {
      log.atInfo().log(`No actors to trim.`);
      res.json({ status: "ok" });
      return;
    }
    const deleteRequests: DeleteRequest[] = [];
    const failedRequests: DeleteRequest[] = [];
    let i = 0;
    for (const row of actorsResult.data) {
      i++;
      for (const trimErrors of [false, true]) {
        const actorId = row.actorId;
        const type = row.type;
        let timestamp: any = undefined;
        try {
          const q = largeLogSizeIds.includes(actorId) ? statQueryLarge : statQuery;
          const tsResult = (await (
            await clickhouse.query({
              query: q,
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
          failedRequests.push({ actorId, type, withoutErrors: !trimErrors, error: e.message });
        }
        if (timestamp) {
          log
            .atInfo()
            .log(
              `${i} of ${len}. Trimming ${
                trimErrors ? "error level" : "non-error levels"
              } for ${actorId} ${type} ${timestamp}`
            );
          deleteRequests.push({ actorId, type, withoutErrors: !trimErrors, timestamp });
        }
      }
    }
    if (deleteRequests.length === 0) {
      if (failedRequests.length > 0) {
        res.json({ status: "error", failed: failedRequests });
        return;
      }
      log.atInfo().log(`No logs to trim.`);
      res.json({ status: "ok" });
      return;
    }
    const deleteQuery =
      `delete from ${metricsSchema}.events_log where\n` +
      deleteRequests
        .map((req, i) => {
          return `(actorId = '${req.actorId}' and type ='${req.type}' and xor(level = 'error', ${req.withoutErrors}) and timestamp < '${req.timestamp}')`;
        })
        .join(" or\n");
    log.atInfo().log(`Delete query:\n${deleteQuery}`);
    try {
      await clickhouse.command({
        query: deleteQuery,
        clickhouse_settings: {
          wait_end_of_query: 0,
          http_wait_end_of_query: 0,
          lightweight_deletes_sync: 0,
          enable_lightweight_delete: 1,
        },
      });
      log.atInfo().log(`Trimmed ${deleteRequests.length} logs in ${sw.elapsedPretty()}`);
      res.json({ status: "ok", deleted: deleteRequests, errors: failedRequests });
      return;
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to trim events log.`);
      res.json({ error: e.message, request: deleteRequests, errors: failedRequests });
      return;
    }
  })
  .toNextApiHandler();
export const config = {
  maxDuration: 300, //10 mins
};
