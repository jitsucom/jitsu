import { z } from "zod";
import { createRoute, verifyAccess, getWorkspace } from "../../../../lib/api";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { getServerLog } from "../../../../lib/server/log";
import { requireDefined, rpc } from "juava";
import { db } from "../../../../lib/server/db";

dayjs.extend(utc);

const log = getServerLog("workspace-metrics");
type MetricsAlias = {
  name: string;
  type: string;
  help: string;
};
const metricsAliases: Record<string, MetricsAlias> = {
  bulkerapp_consumer_queue_size: {
    name: "jitsu_queue_size",
    type: "gauge",
    help: "queue size for each connection",
  },
  connection_message_statuses: {
    name: "jitsu_message_statuses_total",
    type: "counter",
    help: "total number of messages in each status",
  },
};

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
    try {
      const links = await db.prisma().configurationObjectLink.findMany({
        where: {
          deleted: false,
          OR: [{ type: "push" }, { type: null }],
          workspaceId: workspace.id,
          workspace: { deleted: false },
          from: { deleted: false },
          to: { deleted: false },
        },
        include: { from: true, to: true, workspace: true },
      });
      const connections = links
        .map(link => ({
          connectionId: link.id,
          connectionName: `${link.from.config?.["name"]} -> ${link.to.config?.["name"]}`,
          destinationId: link.to.id,
          destinationName: link.to.config?.["name"],
          sourceId: link.from.id,
          sourceName: link.from.config?.["name"],
        }))
        .reduce((acc, link) => {
          acc[link.connectionId] = link;
          return acc;
        }, {});
      res.writeHead(200, {
        "Content-Type": "text/plain",
      });
      const bulkerURLEnv = requireDefined(process.env.BULKER_URL, "env BULKER_URL is not defined");
      const bulkerAuthKey = process.env.BULKER_AUTH_KEY ?? "";
      // access prometheus API
      const url = bulkerURLEnv + "/connections-metrics/" + workspace.id;
      const promMetrics = await rpc(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bulkerAuthKey}`,
        },
      });
      const helpWritten: Record<string, boolean> = {};

      if (promMetrics.status === "success" && promMetrics.data?.resultType === "vector") {
        for (const metric of promMetrics.data.result) {
          const rawLabels = metric.metric;
          const metricsAlias = metricsAliases[rawLabels.__name__];
          const metricName = metricsAlias?.name ?? rawLabels.__name__;
          if (!helpWritten[metricName] && metricsAlias) {
            res.write(`# HELP ${metricName} ${metricsAlias.help}
# TYPE ${metricName} ${metricsAlias.type}\n`);
            helpWritten[metricName] = true;
          }
          const con = connections[rawLabels.destinationId];
          const labels: Record<string, string> = {
            ...con,
            connectionId: rawLabels.destinationId,
            tableName: rawLabels.tableName,
          };
          if (rawLabels.mode) {
            labels.mode = rawLabels.mode;
          }
          if (rawLabels.status) {
            labels.status = rawLabels.status;
          }
          const labelsStr = Object.entries(labels)
            .map(([key, value]) => `${key}="${value ? value.replaceAll(/"/g, '\\"') : ""}"`)
            .join(",");
          res.write(`${metricName}{${labelsStr}} ${metric.value[1]}\n`);
        }
      }
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
