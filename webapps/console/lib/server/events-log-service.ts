import type { PrismaClient } from "@prisma/client";
import type { ClickHouseClient } from "@clickhouse/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { SessionUser } from "../schema";
import { verifyAccess } from "../api";
import { ApiError } from "../shared/errors";

dayjs.extend(utc);

export interface EventsLogServiceDeps {
  clickhouse: ClickHouseClient;
  prisma: PrismaClient;
}

// Event-log `type` values stored in the `events_log` ClickHouse table
// (see bulker/eventslog/events_log.go).
export const EVENTS_LOG_TYPES = ["incoming", "function", "bulker_batch", "bulker_stream"] as const;
export type EventsLogType = (typeof EVENTS_LOG_TYPES)[number];
export const DEAD_LETTER = "dead-letter";
/** All log types a caller may pass to the generic query tool. */
export const QUERYABLE_TYPES = [...EVENTS_LOG_TYPES, DEAD_LETTER] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const ALL = "all";

export interface QueryOpts {
  source?: string;
  limit?: number;
  levels?: string | string[];
  start?: Date | string;
  end?: Date | string;
  search?: string;
}

export interface DeadLetterOpts {
  source?: string;
  type?: string;
  limit?: number;
  start?: Date | string;
  end?: Date | string;
  search?: string;
}

export interface EventSource {
  id: string;
  name: string;
  kind: "stream" | "connection" | "destination" | "profile-builder" | "all";
}

function clampLimit(limit?: number): number {
  if (!limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function chDate(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return dayjs(value).utc().format("YYYY-MM-DD HH:mm:ss.SSS");
}

function levelsArray(levels: string | string[] | undefined): string[] | undefined {
  if (!levels) return undefined;
  const arr = Array.isArray(levels) ? levels : levels.split(",");
  const cleaned = arr.map(l => l.trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

function parseJsonSafe(raw: string, fallbackKey: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return { [fallbackKey]: raw };
  }
}

/**
 * Read-only access to the events-log subsystem (ClickHouse `events_log` + `dead_letter`),
 * extracted from the `pages/api/[workspaceId]/log/*` and `dead-letter` route handlers so the
 * MCP server can query it without the gzip streaming the routes are coupled to.
 *
 * Tenancy note: `events_log` has no workspaceId column — it is scoped by actorId only. A
 * specific source is validated to belong to the workspace; "all sources" resolves the
 * workspace's owned actor ids and filters `actorId IN (...)`. Never query events_log by type
 * alone, or rows from other workspaces would leak. `dead_letter` has a workspaceId column and
 * is filtered by it.
 */
export class EventsLogService {
  private readonly clickhouse: ClickHouseClient;
  private readonly prisma: PrismaClient;

  constructor(deps: EventsLogServiceDeps) {
    this.clickhouse = deps.clickhouse;
    this.prisma = deps.prisma;
  }

  /** Query `events_log` for one of EVENTS_LOG_TYPES. `source` omitted/"all" → across all the workspace's sources. */
  async queryEventsLog(
    user: SessionUser,
    workspaceId: string,
    type: string,
    opts: QueryOpts = {}
  ): Promise<{ date: Date; level: string; content: any }[]> {
    if (!EVENTS_LOG_TYPES.includes(type as EventsLogType)) {
      throw new ApiError(
        `Unknown events-log type '${type}'. Known: ${EVENTS_LOG_TYPES.join(
          ", "
        )} (use the dead-letter tooling for '${DEAD_LETTER}')`,
        { type },
        { status: 400 }
      );
    }
    await verifyAccess(user, workspaceId);
    const limit = clampLimit(opts.limit);

    // Parse once and gate both the SQL clause and the param on the result — gating the
    // clause on raw `opts.levels` while the param is `levelsArray(...)` lets an input like
    // " , " add the clause but leave `levels` undefined, failing the ClickHouse query.
    const parsedLevels = levelsArray(opts.levels);

    let actorFilter: string;
    const query_params: Record<string, any> = {
      type,
      levels: parsedLevels,
      start: chDate(opts.start),
      end: chDate(opts.end),
      search: opts.search,
      limit,
    };

    if (opts.source && opts.source !== ALL) {
      await this.assertActorBelongsToWorkspace(workspaceId, opts.source, type === "incoming" ? "incoming" : "actor");
      actorFilter = "actorId = {actorId:String}";
      query_params.actorId = opts.source;
    } else {
      const actorIds = await this.resolveWorkspaceActorIds(workspaceId, type as EventsLogType);
      if (actorIds.length === 0) return [];
      actorFilter = "actorId in ({actorIds:Array(String)})";
      query_params.actorIds = actorIds;
    }

    const sql = `select timestamp as date, level, message as content from events_log
       where ${actorFilter}
         and type = {type:String}
         ${parsedLevels ? "and level in ({levels:Array(String)})" : ""}
         ${opts.start ? "and timestamp >= {start:String}" : ""}
         ${opts.end ? "and timestamp < {end:String}" : ""}
         ${opts.search ? "and message ilike concat('%',{search:String},'%')" : ""}
       order by timestamp desc limit {limit:UInt32}`;

    const rs = await this.clickhouse.query({
      query: sql,
      query_params,
      format: "JSONEachRow",
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    const rows = (await rs.json()) as { date: string; level: string; content: string }[];
    return rows.map(row => ({
      date: dayjs(row.date).utc(true).toDate(),
      level: row.level,
      content: parseJsonSafe(row.content, "content"),
    }));
  }

  /** Query `dead_letter`. `source` omitted/"all" → all of the workspace's dead-letter records. */
  async queryDeadLetter(
    user: SessionUser,
    workspaceId: string,
    opts: DeadLetterOpts = {}
  ): Promise<{ date: Date; workspaceId: string; actorId: string; type: string; payload: any; error: any }[]> {
    await verifyAccess(user, workspaceId);
    const limit = clampLimit(opts.limit);

    const specificActor = !!opts.source && opts.source !== ALL;
    if (specificActor) {
      await this.assertActorBelongsToWorkspace(workspaceId, opts.source!, "deadletter");
    }

    const sql = `select timestamp as date, workspaceId, actorId, type, payload, error
       from dead_letter
       where workspaceId = {workspaceId:String}
         ${specificActor ? "and actorId = {actorId:String}" : ""}
         ${opts.type ? "and type = {type:String}" : ""}
         ${opts.start ? "and timestamp >= {start:String}" : ""}
         ${opts.end ? "and timestamp < {end:String}" : ""}
         ${
           opts.search
             ? "and (payload ilike concat('%',{search:String},'%') or error ilike concat('%',{search:String},'%'))"
             : ""
         }
       order by timestamp desc limit {limit:UInt32}`;

    const rs = await this.clickhouse.query({
      query: sql,
      query_params: {
        workspaceId,
        actorId: specificActor ? opts.source : undefined,
        type: opts.type,
        start: chDate(opts.start),
        end: chDate(opts.end),
        search: opts.search,
        limit,
      },
      format: "JSONEachRow",
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    const rows = (await rs.json()) as {
      date: string;
      workspaceId: string;
      actorId: string;
      type: string;
      payload: string;
      error: string;
    }[];
    return rows.map(row => {
      const payloadObj = parseJsonSafe(row.payload, "payload");
      return {
        date: dayjs(row.date).utc(true).toDate(),
        workspaceId: row.workspaceId,
        actorId: row.actorId,
        type: row.type,
        payload: payloadObj.httpPayload || payloadObj,
        error: parseJsonSafe(row.error, "error"),
      };
    });
  }

  /** Sources the agent can pass as `source` to query_events, per view. */
  async listEventSources(user: SessionUser, workspaceId: string, type?: string): Promise<EventSource[]> {
    await verifyAccess(user, workspaceId);
    const streams = async (): Promise<EventSource[]> =>
      (
        await this.prisma.configurationObject.findMany({
          where: { workspaceId, type: "stream", deleted: false },
          select: { id: true, config: true },
        })
      ).map(o => ({ id: o.id, name: (o.config as any)?.name ?? o.id, kind: "stream" as const }));

    const destinations = async (): Promise<EventSource[]> =>
      (
        await this.prisma.configurationObject.findMany({
          where: { workspaceId, type: "destination", deleted: false },
          select: { id: true, config: true },
        })
      ).map(o => ({ id: o.id, name: (o.config as any)?.name ?? o.id, kind: "destination" as const }));

    const connections = async (): Promise<EventSource[]> =>
      (
        await this.prisma.configurationObjectLink.findMany({
          where: { workspaceId, deleted: false },
          select: { id: true, fromId: true, toId: true },
        })
      ).map(l => ({ id: l.id, name: `${l.fromId} → ${l.toId}`, kind: "connection" as const }));

    const profileBuilders = async (): Promise<EventSource[]> =>
      (await this.prisma.profileBuilder.findMany({ where: { workspaceId }, select: { id: true, name: true } })).map(
        pb => ({ id: pb.id, name: pb.name, kind: "profile-builder" as const })
      );

    if (type === "incoming") {
      return streams();
    }
    if (type === "function" || type === "bulker_batch" || type === "bulker_stream") {
      return [...(await connections()), ...(await destinations()), ...(await profileBuilders())];
    }
    // dead-letter or unspecified: everything; dead-letter additionally accepts the "all" sentinel.
    const all = [
      ...(await streams()),
      ...(await connections()),
      ...(await destinations()),
      ...(await profileBuilders()),
    ];
    if (type === DEAD_LETTER) {
      return [{ id: ALL, name: "All sources", kind: "all" }, ...all];
    }
    return all;
  }

  /**
   * The workspace's valid actor ids for the given log type — streams for `incoming`,
   * connections/destinations/profile-builders for `function`/`bulker_*`. Used to scope an
   * "all sources" events_log query to actor kinds that actually emit that type, so unrelated
   * ids (and cross-table id collisions) can't widen the result set.
   */
  private async resolveWorkspaceActorIds(workspaceId: string, type: EventsLogType): Promise<string[]> {
    if (type === "incoming") {
      const streams = await this.prisma.configurationObject.findMany({
        where: { workspaceId, type: "stream", deleted: false },
        select: { id: true },
      });
      return [...new Set(streams.map(s => s.id))];
    }
    // function / bulker_batch / bulker_stream → connections, destinations, profile builders.
    const [links, destinations, pbs] = await Promise.all([
      this.prisma.configurationObjectLink.findMany({ where: { workspaceId, deleted: false }, select: { id: true } }),
      this.prisma.configurationObject.findMany({
        where: { workspaceId, type: "destination", deleted: false },
        select: { id: true },
      }),
      this.prisma.profileBuilder.findMany({ where: { workspaceId }, select: { id: true } }),
    ]);
    return [...new Set([...links.map(l => l.id), ...destinations.map(d => d.id), ...pbs.map(p => p.id)])];
  }

  /**
   * Mirror of the route handlers' actor-ownership checks (throws 403 if `actorId` isn't in the
   * workspace). The allowed actor kinds differ by log type:
   *   - incoming   → any config object (the incoming route doesn't restrict by type)
   *   - actor      → link / profile-builder / destination (events_log function/bulker route)
   *   - deadletter → any config object / link / profile-builder (the dead-letter route is broad,
   *                  and list_event_sources("dead-letter") advertises streams as valid sources)
   */
  private async assertActorBelongsToWorkspace(
    workspaceId: string,
    actorId: string,
    mode: "incoming" | "actor" | "deadletter"
  ) {
    const reject = () => {
      throw new ApiError(`source '${actorId}' doesn't belong to the current workspace`, {}, { status: 403 });
    };
    if (mode === "incoming") {
      if (!(await this.prisma.configurationObject.findFirst({ where: { id: actorId, workspaceId } }))) reject();
      return;
    }
    if (mode === "deadletter") {
      const [obj, link, pb] = await Promise.all([
        this.prisma.configurationObject.findFirst({ where: { id: actorId, workspaceId } }),
        this.prisma.configurationObjectLink.findFirst({ where: { id: actorId, workspaceId } }),
        this.prisma.profileBuilder.findFirst({ where: { id: actorId, workspaceId } }),
      ]);
      if (!obj && !link && !pb) reject();
      return;
    }
    // mode === "actor": links, profile builders, or destinations only — not any config object
    // (a stream/service/function id must not be accepted, especially since ids could collide
    // across tables).
    const [link, pb, dst] = await Promise.all([
      this.prisma.configurationObjectLink.findFirst({ where: { id: actorId, workspaceId } }),
      this.prisma.profileBuilder.findFirst({ where: { id: actorId, workspaceId } }),
      this.prisma.configurationObject.findFirst({ where: { id: actorId, workspaceId, type: "destination" } }),
    ]);
    if (!link && !pb && !dst) reject();
  }
}
