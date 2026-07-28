import type { NextApiResponse } from "next";
import { z } from "zod";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import zlib from "zlib";
import { pipeline } from "node:stream";
import { db } from "./db";
import { clickhouse } from "./clickhouse";
import { getServerLog } from "./log";
import { ApiError } from "../shared/errors";
import { SessionUser } from "../schema";
import { verifyAccess } from "../api";

dayjs.extend(utc);

const log = getServerLog("events-log");

//Vercel Limit:  https://vercel.com/docs/functions/streaming-functions#limitations-for-streaming-edge-functions
const maxStreamingResponseSize = 100_000_000;

/**
 * Query params shared by both events-log routes: `log/[type]` (all the actors of the workspace)
 * and `log/[type]/[actorId]` (a single actor)
 */
export const eventsLogQuery = z.object({
  type: z.string(),
  workspaceId: z.string(),
  levels: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
  start: z.coerce.date().optional(),
  end: z.coerce.date().optional(),
  //people can search for ISO timestamps. that we automatically convert to date
  search: z.any().optional(),
});

export type EventsLogQuery = z.infer<typeof eventsLogQuery>;

/**
 * Checks that the actor belongs to the workspace. Allowed actor kinds differ by log type:
 * `incoming` is emitted by streams, everything else by connections / destinations / profile builders
 */
async function assertActorBelongsToWorkspace(workspaceId: string, actorId: string, type: string) {
  if (type === "incoming") {
    const source = await db.prisma().configurationObject.findFirst({ where: { id: actorId, workspaceId } });
    if (!source) {
      throw new ApiError(`site doesn't belong to the current workspace`, { status: 403 });
    }
    return;
  }
  const [link, pb, dst] = await Promise.all([
    db.prisma().configurationObjectLink.findFirst({ where: { id: actorId, workspaceId } }),
    db.prisma().profileBuilder.findFirst({ where: { id: actorId, workspaceId } }),
    db.prisma().configurationObject.findFirst({ where: { id: actorId, workspaceId, type: "destination" } }),
  ]);
  if (!link && !pb && !dst) {
    throw new ApiError(`connection doesn't belong to the current workspace`, { status: 403 });
  }
}

/**
 * `events_log` has no workspaceId column — it is scoped by actorId only. To serve the "all actors"
 * view we resolve the actor ids the workspace owns and filter by them, otherwise rows of other
 * workspaces would leak. Scoping to the actor kinds that actually emit the requested type also
 * keeps unrelated ids (and id collisions across tables) from widening the result set
 */
async function workspaceActorIds(workspaceId: string, type: string): Promise<string[]> {
  if (type === "incoming") {
    const streams = await db
      .prisma()
      .configurationObject.findMany({ where: { workspaceId, type: "stream", deleted: false }, select: { id: true } });
    return [...new Set(streams.map(s => s.id))];
  }
  const [links, destinations, pbs] = await Promise.all([
    db.prisma().configurationObjectLink.findMany({ where: { workspaceId, deleted: false }, select: { id: true } }),
    db.prisma().configurationObject.findMany({
      where: { workspaceId, type: "destination", deleted: false },
      select: { id: true },
    }),
    db.prisma().profileBuilder.findMany({ where: { workspaceId }, select: { id: true } }),
  ]);
  return [...new Set([...links.map(l => l.id), ...destinations.map(d => d.id), ...pbs.map(p => p.id)])];
}

/**
 * Streams events log records as gzipped ndjson. `actorId` omitted → records of every actor of the
 * workspace; each record carries `actorId` so the UI can tell them apart
 */
export async function streamEventsLog({
  user,
  res,
  query,
  actorId,
}: {
  user: SessionUser;
  res: NextApiResponse;
  query: EventsLogQuery;
  actorId?: string;
}) {
  log.atDebug().log("GET", JSON.stringify({ ...query, actorId }, null, 2));
  await verifyAccess(user, query.workspaceId);

  let actorIds: string[] = [];
  if (actorId) {
    await assertActorBelongsToWorkspace(query.workspaceId, actorId, query.type);
  } else {
    actorIds = await workspaceActorIds(query.workspaceId, query.type);
  }

  res.writeHead(200, {
    "Content-Type": "application/x-ndjson",
    "Content-Encoding": "gzip",
  });

  if (!actorId && actorIds.length === 0) {
    //nothing to query - the workspace has no actors of this kind. The body still must be a valid
    //(empty) gzip stream, since Content-Encoding is already announced
    await new Promise<void>(resolve => {
      const emptyGzip = zlib.createGzip();
      pipeline(emptyGzip, res, () => resolve());
      emptyGzip.end();
    });
    return;
  }

  const sqlQuery = `select timestamp as date, level, actorId, message as content from events_log
     where
         ${actorId ? "actorId = {actorId:String}" : "actorId in ({actorIds:Array(String)})"}
         and type = {type:String}
         ${query.levels ? "and level in ({levels:Array(String)})" : ""}
         ${query.start ? "and timestamp >= {start:String}" : ""}
         ${query.end ? "and timestamp < {end:String}" : ""}
         ${query.search ? "and message ilike concat('%',{search:String},'%')" : ""}
     order by timestamp desc limit {limit:UInt32}`;
  const chResult = await clickhouse.query({
    query: sqlQuery,
    query_params: {
      actorId,
      actorIds: actorId ? undefined : actorIds,
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
          actorId: row.actorId,
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
}
