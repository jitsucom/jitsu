import { getSingleton } from "juava";
import { requireDefined } from "juava";
import { getServerLog } from "@jitsu-internal/console/lib/server/log";
import { FunctionExecLog } from "./functions-chain";
import fetch from "node-fetch-commonjs";
import { Readable } from "stream";

export const log = getServerLog("metrics");

const bulkerBase = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
const bulkerAuthKey = requireDefined(process.env.BULKER_AUTH_KEY, "env BULKER_AUTH_KEY is not defined");
const metricsDestinationId = process.env.METRICS_DESTINATION_ID;
const metricsTable = "active_incoming";
const max_batch_size = 10000;
const flush_interval_ms = 60000;

export const metrics = getSingleton("metrics", createMetrics);

type MetricsEvent = {
  timestamp: string;
  workspaceId: string;
  messageId: string;
};

interface Metrics {
  logMetrics: (workspaceId: string, messageId: string, execLog: FunctionExecLog) => Promise<void>;
}

function createMetrics(): Metrics {
  const buffer: MetricsEvent[] = [];

  const flush = async () => {
    //create readable stream
    const stream = new Readable();
    const res = fetch(`${bulkerBase}/bulk/${metricsDestinationId}?tableName=${metricsTable}&mode=batch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bulkerAuthKey}` },
      body: stream,
    });
    buffer.forEach(e => {
      stream.push(JSON.stringify(e));
      stream.push("\n");
    });
    //close stream
    stream.push(null);
    res
      .then(r => {
        if (!r.ok) {
          log.atError().log(`Failed to flush metrics events: ${r.status} ${r.statusText}`);
        }
      })
      .catch(e => {
        log.atError().withCause(e).log(`Failed to flush metrics events`);
      });
    buffer.length = 0;
  };

  setInterval(async () => {
    if (buffer.length > 0) {
      log.atInfo().log(`Periodic flushing ${buffer.length} metrics events`);
      await flush();
    }
  }, flush_interval_ms);

  return {
    logMetrics: async (workspaceId: string, messageId: string, execLog: FunctionExecLog) => {
      if (!metricsDestinationId) {
        return;
      }
      const processedIdx = execLog.findIndex(l => !l.dropped && l.functionId.startsWith("builtin.destination."));
      if (processedIdx < 0) {
        return;
      }
      const d = new Date();
      d.setMilliseconds(0);
      d.setSeconds(0);
      buffer.push({
        timestamp: d.toISOString(),
        workspaceId,
        messageId,
      });
      if (buffer.length >= max_batch_size) {
        log.atInfo().log(`Flushing ${buffer.length} metrics events`);
        setImmediate(flush);
      }
    },
  };
}
