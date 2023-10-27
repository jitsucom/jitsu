import { getSingleton } from "juava";
import { requireDefined } from "juava";
import { getServerLog } from "@jitsu-internal/console/lib/server/log";
import { FunctionExecLog, FunctionExecRes } from "./functions-chain";
import fetch from "node-fetch-commonjs";
import { Readable } from "stream";
import { httpAgent, httpsAgent } from "@jitsu-internal/console/lib/server/http-agent";
import { MetricsMeta } from "@jitsu/core-functions";
import omit from "lodash/omit";

export const log = getServerLog("metrics");

const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");
const metricsDestinationId = process.env.METRICS_DESTINATION_ID;
const oldMetricsTable = "active_incoming";
const metricsTable = "metrics";

const max_batch_size = 10000;
const flush_interval_ms = 60000;

export const metrics = getSingleton("metrics", createMetrics);

type MetricsEvent = MetricsMeta & {
  functionId: string;
  timestamp: string;
  status: string;
  events: number;
};

interface Metrics {
  logMetrics: (execLog: FunctionExecLog) => Promise<void>;
}

function createMetrics(): Metrics {
  const buffer: MetricsEvent[] = [];

  const flush = async (buf: MetricsEvent[]) => {
    //create readable stream
    const streamOld = new Readable();
    const resOld = fetch(`${bulkerBase}/bulk/${metricsDestinationId}?tableName=${oldMetricsTable}&mode=batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bulkerAuthKey}` },
      body: streamOld,
      agent: (bulkerBase.startsWith("https://") ? httpsAgent : httpAgent)(),
    });
    const stream = new Readable();
    const res = fetch(`${bulkerBase}/bulk/${metricsDestinationId}?tableName=${metricsTable}&mode=batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bulkerAuthKey}` },
      body: stream,
      agent: (bulkerBase.startsWith("https://") ? httpsAgent : httpAgent)(),
    });
    buf.forEach(e => {
      if (e.functionId.startsWith("builtin.destination.") && e.status !== "dropped") {
        streamOld.push(
          JSON.stringify({
            timestamp: e.timestamp,
            workspaceId: e.workspaceId,
            messageId: e.messageId,
          })
        );
        streamOld.push("\n");
      }
      stream.push(JSON.stringify(omit(e, "retries")));
      stream.push("\n");
    });
    //close stream
    streamOld.push(null);
    stream.push(null);
    await Promise.all([
      resOld
        .then(r => {
          if (!r.ok) {
            log.atError().log(`Failed to flush metrics events(old): ${r.status} ${r.statusText}`);
          }
        })
        .catch(e => {
          log.atError().withCause(e).log(`Failed to flush metrics events(old)`);
        }),
      res
        .then(r => {
          if (!r.ok) {
            log.atError().log(`Failed to flush metrics events: ${r.status} ${r.statusText}`);
          }
        })
        .catch(e => {
          log.atError().withCause(e).log(`Failed to flush metrics events`);
        }),
    ]);
  };

  setInterval(async () => {
    if (buffer.length > 0) {
      log.atInfo().log(`Periodic flushing ${buffer.length} metrics events`);
      await flush([...buffer]);
      buffer.length = 0;
    }
  }, flush_interval_ms);

  return {
    logMetrics: async (execLog: FunctionExecLog) => {
      if (!metricsDestinationId) {
        return;
      }

      const d = new Date();
      d.setMilliseconds(0);
      d.setSeconds(0);

      for (const el of execLog) {
        if (!el.metricsMeta) {
          continue;
        }
        // console.log(
        //   `${el.metricsMeta.connectionId} ${el.metricsMeta.messageId} ${el.functionId} ${el.error} ${el.dropped} ${el.metricsMeta.retries}`
        // );
        const status = ((el: FunctionExecRes) => {
          let prefix = el.functionId.startsWith("builtin.destination.") ? "" : "function_";
          let status = "success";
          if (el.error) {
            if (el.metricsMeta?.retries) {
              prefix = prefix + "retry_";
            }
            status = "error";
          } else if (el.dropped) {
            prefix = "";
            status = "dropped";
          } else if (el.functionId === "builtin.destination.bulker") {
            status = "processed";
          }
          return prefix + status;
        })(el);
        buffer.push({
          timestamp: d.toISOString(),
          ...el.metricsMeta,
          functionId: el.functionId,
          status,
          events: 1,
        });
      }
      if (buffer.length >= max_batch_size) {
        log.atInfo().log(`Flushing ${buffer.length} metrics events`);
        setImmediate(() => flush([...buffer]));
        buffer.length = 0;
      }
    },
  };
}
