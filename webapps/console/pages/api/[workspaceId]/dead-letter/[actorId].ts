import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../lib/api";
import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { getServerLog } from "../../../../lib/server/log";
import { ApiError } from "../../../../lib/shared/errors";
import { clickhouse } from "../../../../lib/server/clickhouse";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import zlib from "zlib";
import { pipeline } from "node:stream";
import { getServerEnv } from "../../../../lib/server/serverEnv";
dayjs.extend(utc);

const log = getServerLog("dead-letter");
const serverEnv = getServerEnv();
const metricsSchema = serverEnv.CLICKHOUSE_METRICS_SCHEMA || serverEnv.CLICKHOUSE_DATABASE || "newjitsu_metrics";

//Vercel Limit:  https://vercel.com/docs/functions/streaming-functions#limitations-for-streaming-edge-functions
const maxStreamingResponseSize = 100_000_000;

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    types: {
      query: z.object({
        workspaceId: z.string(),
        actorId: z.string(),
        type: z.string().optional(),
        limit: z.coerce.number().optional().default(50),
        start: z.coerce.date().optional(),
        end: z.coerce.date().optional(),
        search: z.any().optional(),
      }),
      result: z.any(),
    },
    streaming: true,
    auth: true,
    handle: async ({ user, req, res, query }) => {
      log.atDebug().log("GET", JSON.stringify(query, null, 2));
      await verifyAccess(user, query.workspaceId);

      // Verify that the actorId belongs to the workspace if not "all"
      if (query.actorId !== "all") {
        const source = await db
          .prisma()
          .configurationObject.findFirst({ where: { id: query.actorId, workspaceId: query.workspaceId } });
        const link = await db
          .prisma()
          .configurationObjectLink.findFirst({ where: { id: query.actorId, workspaceId: query.workspaceId } });
        const pb = await db
          .prisma()
          .profileBuilder.findFirst({ where: { id: query.actorId, workspaceId: query.workspaceId } });

        if (!source && !link && !pb) {
          throw new ApiError(`actor doesn't belong to the current workspace`, {}, { status: 403 });
        }
      }

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson",
        "Content-Encoding": "gzip",
      });

      const sqlQuery = `select
          timestamp as date,
          workspaceId,
          actorId,
          type,
          payload,
          error
        from ${metricsSchema}.dead_letter
        where
          workspaceId = {workspaceId:String}
          ${query.actorId !== "all" ? "and actorId = {actorId:String}" : ""}
          ${query.type ? "and type = {type:String}" : ""}
          ${query.start ? "and timestamp >= {start:String}" : ""}
          ${query.end ? "and timestamp < {end:String}" : ""}
          ${
            query.search
              ? "and (payload ilike concat('%',{search:String},'%') or error ilike concat('%',{search:String},'%'))"
              : ""
          }
        order by timestamp desc
        limit {limit:UInt32}`;

      const chResult = await clickhouse.query({
        query: sqlQuery,
        query_params: {
          workspaceId: query.workspaceId,
          actorId: query.actorId !== "all" ? query.actorId : undefined,
          type: query.type,
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
          let errorObj = {};
          try {
            errorObj = JSON.parse(row.error);
          } catch (e) {
            errorObj = { error: row.error };
          }
          let payloadObj: any = {};
          try {
            payloadObj = JSON.parse(row.payload);
          } catch (e) {
            payloadObj = { payload: row.payload };
          }
          if (gzip.bytesWritten < maxStreamingResponseSize) {
            const line = JSON.stringify({
              date: dayjs(row.date).utc(true).toDate(),
              workspaceId: row.workspaceId,
              actorId: row.actorId,
              type: row.type,
              payload: payloadObj.httpPayload || payloadObj,
              error: errorObj,
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
