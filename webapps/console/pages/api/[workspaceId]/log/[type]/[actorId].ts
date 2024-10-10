import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { db } from "../../../../../lib/server/db";
import { z } from "zod";
import { getServerLog } from "../../../../../lib/server/log";
import { ApiError } from "../../../../../lib/shared/errors";
import { clickhouse } from "../../../../../lib/server/clickhouse";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

const log = getServerLog("events-log");
const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";

//Vercel Limit:  https://vercel.com/docs/functions/runtimes#request-body-size
const maxResponseSize = 4500000;

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    types: {
      query: z.object({
        type: z.string(),
        workspaceId: z.string(),
        actorId: z.string(),
        levels: z.string().optional(),
        limit: z.coerce.number().optional().default(50),
        start: z.coerce.date().optional(),
        end: z.coerce.date().optional(),
      }),
      result: z.any(),
    },
    auth: true,
    handle: async ({ user, req, res, query }) => {
      log.atDebug().log("GET", JSON.stringify(query, null, 2));
      await verifyAccess(user, query.workspaceId);
      if (query.type === "incoming") {
        const source = await db
          .prisma()
          .configurationObject.findFirst({ where: { id: query.actorId, workspaceId: query.workspaceId } });
        if (!source) {
          throw new ApiError(`site doesn't belong to the current workspace`, {}, { status: 403 });
        }
      } else {
        const link = await db
          .prisma()
          .configurationObjectLink.findFirst({ where: { id: query.actorId, workspaceId: query.workspaceId } });
        const pb = await db
          .prisma()
          .profileBuilder.findFirst({ where: { id: query.actorId, workspaceId: query.workspaceId } });
        if (!link && !pb) {
          throw new ApiError(`connection doesn't belong to the current workspace`, {}, { status: 403 });
        }
      }
      const sqlQuery = `select timestamp as date, level, message as content from ${metricsSchema}.events_log 
         where 
             actorId = {actorId:String} 
             and type = {type:String}
             ${query.levels ? "and level in ({levels:Array(String)})" : ""}
             ${query.start ? "and timestamp >= {start:String}" : ""}
             ${query.end ? "and timestamp < {end:String}" : ""}
        order by timestamp desc limit {limit:UInt32}`;
      const result: any[] = [];

      const chResult = (await (
        await clickhouse.query({
          query: sqlQuery,
          query_params: {
            actorId: query.actorId,
            type: query.type,
            levels: query.levels ? query.levels.split(",") : undefined,
            start: query.start ? dayjs(query.start).utc().format("YYYY-MM-DD HH:mm:ss.SSS") : undefined,
            end: query.end ? dayjs(query.end).utc().format("YYYY-MM-DD HH:mm:ss.SSS") : undefined,
            limit: query.limit,
          },
          clickhouse_settings: {
            wait_end_of_query: 1,
          },
        })
      ).json()) as any;
      let written = 0;
      for (const row of chResult.data) {
        written += row.content.length + 70;
        if (written > maxResponseSize) {
          break;
        }
        result.push({
          date: dayjs(row.date).utc(true).toDate(),
          level: row.level,
          content: JSON.parse(row.content),
        });
      }
      res.json(result);
    },
  },
};

export default nextJsApiHandler(api);
