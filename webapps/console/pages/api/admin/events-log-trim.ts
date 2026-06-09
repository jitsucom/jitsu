import { createRoute, getUser, verifyAdmin } from "../../../lib/api";
import { stopwatch } from "juava";
import { clickhouse } from "../../../lib/server/clickhouse";
import dayjs from "dayjs";
import { getServerLog } from "../../../lib/server/log";
import { getServerEnv } from "../../../lib/server/serverEnv";

const log = getServerLog("events-log-trim");

const localIps = ["127.0.0.1", "0:0:0:0:0:0:0:1", "::1", "::ffff:127.0.0.1"];

export default createRoute()
  .GET({
    streaming: true,
    // GET but issues ClickHouse ALTER/DELETE statements. CronJob target;
    // skips during maintenance and retries on next tick.
    mutates: true,
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
    const serverEnv = getServerEnv();
    const metricsCluster = serverEnv.CLICKHOUSE_METRICS_CLUSTER || serverEnv.CLICKHOUSE_CLUSTER;
    const onCluster = metricsCluster ? ` ON CLUSTER ${metricsCluster}` : "";
    const eventsLogSize = serverEnv.EVENTS_LOG_SIZE ?? 200000;
    const sw = stopwatch();

    // Retention is enforced by a dictGet-driven TTL on events_log (see
    // events-log-init): the `events_log_cutoff` dictionary holds the newest
    // EVENTS_LOG_SIZE-th timestamp per (actorId, type, is_error), and the TTL
    // deletes anything older on merge. This cron only has to: drop the old
    // partition (hard floor), refresh the cutoffs, and re-materialize the TTL
    // on the live partitions so a moved cutoff is applied to already-merged
    // parts (background merges don't re-evaluate a part whose stored TTL says
    // "keep"). No more full-table scans or lightweight deletes.

    // 1. Hard floor: drop partitions older than the retention window.
    const dropPartitionQuery: string = `alter table events_log ${onCluster} drop partition {partition:String}`;
    const oldPartition = dayjs().subtract(2, "month").format("YYYYMM");
    try {
      await clickhouse.command({
        query: dropPartitionQuery,
        query_params: { partition: oldPartition },
        clickhouse_settings: {
          // allow to drop partitions up to 500gb in size
          max_partition_size_to_drop: 536870912000,
        },
      });
      log.atInfo().log(`Dropped partition ${oldPartition}`);
    } catch (e: any) {
      log.atDebug().withCause(e).log(`Failed to drop partition ${oldPartition}`);
    }

    // Collect failures of the retention-critical steps so the cron can retry.
    // (Dropping the floor partition is best-effort and not counted.)
    const errors: string[] = [];

    // 2. Recompute the per-entity retention cutoffs: the timestamp of the
    //    EVENTS_LOG_SIZE-th newest row per entity, only for entities over the
    //    cap. Build into the staging table and EXCHANGE it into place so the
    //    live events_log_cutoff_src is replaced atomically — a transient failure
    //    here never leaves it empty (which the dictionary's LIFETIME reload
    //    would otherwise pick up, pausing retention). Reload/materialize below
    //    run only if this succeeds, so the dictionary keeps the last-good
    //    cutoffs on failure.
    //    NOTE: single-shard assumption — the INSERT..SELECT reads events_log on
    //    the node it runs on; a sharded events_log would need a per-shard
    //    recompute (e.g. via a Distributed/cluster read).
    let cutoffsRecomputed = false;
    try {
      await clickhouse.command({ query: `truncate table events_log_cutoff_staging${onCluster}` });
      // Use a window row_number to find the EVENTS_LOG_SIZE-th newest timestamp
      // per entity rather than groupArray()+sort: groupArray materializes every
      // group's full timestamp array before HAVING filters (≈all live rows in
      // memory — measured ~5 GiB on the prod table), whereas row_number streams
      // and only emits the boundary row (≈7x less memory). Entities with fewer
      // than EVENTS_LOG_SIZE rows never reach that rank, so they get no cutoff.
      await clickhouse.command({
        query: `insert into events_log_cutoff_staging
                  select actorId, type, is_error, cutoff
                  from (
                    select actorId,
                           type,
                           toUInt8(level = 'error') as is_error,
                           timestamp as cutoff,
                           row_number() over (partition by actorId, type, level = 'error'
                                              order by timestamp desc) as rn
                    from events_log
                  )
                  where rn = ${eventsLogSize}`,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
      await clickhouse.command({
        query: `exchange tables events_log_cutoff_src and events_log_cutoff_staging${onCluster}`,
      });
      cutoffsRecomputed = true;
      log.atInfo().log(`Recomputed events_log_cutoff_src`);
    } catch (e: any) {
      log.atError().withCause(e).log(`Failed to recompute cutoffs; keeping last-good values`);
      errors.push(`recompute cutoffs: ${e.message}`);
    }

    if (cutoffsRecomputed) {
      // 3. Reload the cutoff dictionary from the freshly computed source table.
      try {
        await clickhouse.command({ query: `system reload dictionary${onCluster} events_log_cutoff` });
        log.atInfo().log(`Reloaded events_log_cutoff dictionary`);
      } catch (e: any) {
        log.atError().withCause(e).log(`Failed to reload events_log_cutoff dictionary`);
        errors.push(`reload dictionary: ${e.message}`);
      }

      // 4. Enforce the cap by re-materializing the TTL on the live partitions.
      //    Async (mutations_sync=0); allow_suspicious_ttl_expressions and
      //    allow_nondeterministic_mutations are required because the TTL uses dictGet.
      const materializeQuery: string = `alter table events_log ${onCluster} materialize TTL in partition {partition:String}`;
      const partitions = [dayjs().format("YYYYMM"), dayjs().subtract(1, "month").format("YYYYMM")];
      for (const partition of partitions) {
        try {
          await clickhouse.command({
            query: materializeQuery,
            query_params: { partition },
            clickhouse_settings: {
              allow_suspicious_ttl_expressions: 1,
              allow_nondeterministic_mutations: 1,
              mutations_sync: "0",
            },
          });
          log.atInfo().log(`Materialized TTL on partition ${partition}`);
        } catch (e: any) {
          log.atError().withCause(e).log(`Failed to materialize TTL on partition ${partition}`);
          errors.push(`materialize TTL ${partition}: ${e.message}`);
        }
      }
    } else {
      log.atError().log(`Skipping dictionary reload and TTL materialize because cutoff recompute failed`);
    }

    if (errors.length > 0) {
      log.atError().log(`Events log trim finished with ${errors.length} error(s) in ${sw.elapsedPretty()}`);
      res.status(500).json({ status: "error", errors });
      return;
    }
    log.atInfo().log(`Events log trim issued in ${sw.elapsedPretty()}`);
    res.json({ status: "ok" });
    return;
  })
  .toNextApiHandler();
export const config = {
  maxDuration: 300, //10 mins
};
