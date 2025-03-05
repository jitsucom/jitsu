import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { db } from "../../../../../lib/server/db";
import { z } from "zod";
import { getServerLog } from "../../../../../lib/server/log";
import { ApiError } from "../../../../../lib/shared/errors";
import { clickhouse } from "../../../../../lib/server/clickhouse";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import zlib from "zlib";
import { pipeline } from "node:stream";
dayjs.extend(utc);

const log = getServerLog("events-log");
const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";

//Vercel Limit:  https://vercel.com/docs/functions/streaming-functions#limitations-for-streaming-edge-functions
const maxStreamingResponseSize = 100_000_000;

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
        //people can search for ISO timestamps. that we automatically convert to date
        search: z.any().optional(),
      }),
      result: z.any(),
    },
    streaming: true,
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
        const dst = await db.prisma().configurationObject.findFirst({
          where: { id: query.actorId, workspaceId: query.workspaceId, type: "destination" },
        });
        if (!link && !pb && !dst) {
          throw new ApiError(`connection doesn't belong to the current workspace`, {}, { status: 403 });
        }
      }
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Content-Encoding": "gzip",
      });
      const sqlQuery = `select timestamp as date, level, message as content from ${metricsSchema}.events_log 
         where 
             actorId = {actorId:String} 
             and type = {type:String}
             ${query.levels ? "and level in ({levels:Array(String)})" : ""}
             ${query.start ? "and timestamp >= {start:String}" : ""}
             ${query.end ? "and timestamp < {end:String}" : ""}
                ${query.search ? "and message ilike concat('%',{search:String},'%')" : ""}
                        order by timestamp desc limit {limit:UInt32}`;
      const chResult = await clickhouse.query({
        query: sqlQuery,
        query_params: {
          actorId: query.actorId,
          type: query.type,
          levels: query.levels ? query.levels.split(",") : undefined,
          start: query.start ? dayjs(query.start).utc().format("YYYY-MM-DD HH:mm:ss.SSS") : undefined,
          end: query.end ? dayjs(query.end).utc().format("YYYY-MM-DD HH:mm:ss.SSS") : undefined,
          search:
            typeof query.search === "undefined"
              ? undefined
              : query.search instanceof Date
              ? query.search.toISOString()
              : query.search,
          limit: query.limit,
        },
        format: "JSONEachRow",
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      });
      var responsePromiseResolve;
      let responsePromise = new Promise<void>((resolve, reject) => {
        responsePromiseResolve = resolve;
      });
      const gzip = zlib.createGzip();
      pipeline(gzip, res, err => {
        if (err) {
          log.atError().withCause(err).log("Error piping data to response");
        }
        responsePromiseResolve();
      });
      const stream = chResult.stream();
      stream.on("data", rs => {
        for (const r of rs) {
          const row = r.json() as any;
          if (gzip.bytesWritten < maxStreamingResponseSize) {
            const line = JSON.stringify({
              date: dayjs(row.date).utc(true).toDate(),
              level: row.level,
              content: JSON.parse(row.content),
            });
            gzip.write(line + "\n");
          } else {
            stream.destroy();
          }
        }
      });
      stream.on("error", err => {
        log.atError().withCause(err).log("Error streaming data");
        gzip.end();
      });
      stream.on("close", () => {
        gzip.end();
      });
      stream.on("end", () => {
        gzip.end();
      });
      //wait for stream end
      await responsePromise;
    },
  },
};

export default nextJsApiHandler(api);
