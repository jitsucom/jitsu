import type { PrismaClient } from "@prisma/client";
import type { Pool } from "pg";
import type { ClickHouseClient } from "@clickhouse/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { SessionUser } from "../schema";
import { verifyAccess } from "../api";
import { ApiError } from "../shared/errors";

dayjs.extend(utc);

export interface ReportsServiceDeps {
  prisma: PrismaClient;
  pgPool: Pool;
  clickhouse: ClickHouseClient;
}

export interface StatPeriodOpts {
  start?: Date | string;
  end?: Date | string;
  granularity?: "day" | "hour";
}

function isoDateToClickhouse(date: string): string {
  return date.replace("T", " ").replace("Z", "").split(".")[0];
}

function periodToISOString(period: string) {
  const [date, time] = period.split(" ");
  return `${date}T${time}Z`;
}

/**
 * Workspace statistics extracted from the `pages/api/[workspaceId]/reports/*` and
 * `profile-builder/stats.ts` route handlers so the MCP server shares one implementation.
 * Defaults match the routes: a missing period means "the last month".
 */
export class ReportsService {
  private readonly prisma: PrismaClient;
  private readonly pgPool: Pool;
  private readonly clickhouse: ClickHouseClient;

  constructor(deps: ReportsServiceDeps) {
    this.prisma = deps.prisma;
    this.pgPool = deps.pgPool;
    this.clickhouse = deps.clickhouse;
  }

  private resolvePeriod(opts: StatPeriodOpts): { start: string; end: string } {
    const end = opts.end ? new Date(opts.end).toISOString() : new Date().toISOString();
    const start = opts.start ? new Date(opts.start).toISOString() : dayjs(end).subtract(1, "month").toISOString();
    return { start, end };
  }

  /**
   * Event counts per period/connection/stream/destination/status from the ClickHouse metrics
   * view (mirrors `reports/event-stat.ts`).
   */
  async eventStat(user: SessionUser, workspaceId: string, opts: StatPeriodOpts = {}): Promise<any> {
    await verifyAccess(user, workspaceId);
    const { start, end } = this.resolvePeriod(opts);
    const granularity = opts.granularity ?? "day";
    const sql = `
        select
            date_trunc({granularity:String}, timestamp) as period,
            connectionId,
            streamId,
            destinationId,
            status,
            sumMerge(events) as events
        from mv_metrics
        where
            timestamp >= toDateTime({start:String}, 'UTC') and
            timestamp < toDateTime({end:String}, 'UTC') and
            workspaceId = {workspace:String}
        group by period, connectionId, status, streamId, destinationId
        order by period desc, events desc;
    `;
    const chResult = (await (
      await this.clickhouse.query({
        query: sql,
        query_params: {
          start: isoDateToClickhouse(start),
          end: isoDateToClickhouse(end),
          workspace: workspaceId,
          granularity,
        },
        clickhouse_settings: { wait_end_of_query: 1 },
      })
    ).json()) as any;
    return {
      start,
      end,
      granularity,
      rows: chResult.data.map(({ period, ...rest }: any) => ({
        ...rest,
        period: periodToISOString(period),
        workspaceId,
      })),
    };
  }

  /** Count of distinct source→destination pairs with a successful task in the period (mirrors `reports/sync-stat.ts`). */
  async syncStat(user: SessionUser, workspaceId: string, opts: StatPeriodOpts = {}): Promise<any> {
    await verifyAccess(user, workspaceId);
    const { start, end } = this.resolvePeriod(opts);
    const res = await this.pgPool.query(
      `select
              count(distinct (sync."fromId", sync."toId")) as "activeSyncs"
          from newjitsu.source_task task
               join newjitsu."ConfigurationObjectLink" sync on task.sync_id = sync."id"
          where (task.status = 'SUCCESS' OR task.status = 'PARTIAL')
            and "workspaceId" = $1
            and started_at >= $2 and started_at < $3`,
      [workspaceId, start, end]
    );
    return { activeSyncs: res.rows[0].activeSyncs, start, end };
  }

  /**
   * Build progress of a profile-builder version (mirrors `profile-builder/stats.ts`).
   * `version` omitted → the builder's current version.
   */
  async profileBuilderStats(
    user: SessionUser,
    workspaceId: string,
    opts: { profileBuilderId: string; version?: number }
  ): Promise<any> {
    await verifyAccess(user, workspaceId);
    const pb = await this.prisma.profileBuilder.findFirst({
      where: { id: opts.profileBuilderId, workspaceId },
    });
    if (!pb) {
      throw new ApiError(`Profile Builder ${opts.profileBuilderId} not found`, { status: 404 });
    }
    const version = opts.version ?? pb.version;
    try {
      const res = await this.pgPool.query(
        `select "profileBuilderId",
                "profileBuilderVersion",
                min("startedAt") "startedAt",
                max("lastTimestamp") "lastTimestamp",
                sum("totalUsers") "totalUsers",
                sum("processedUsers") "processedUsers",
                sum("errorUsers") "errorUsers",
                avg(speed) speed
         from newjitsu."ProfileBuilderState" where "profileBuilderId" = $1 and "profileBuilderVersion" = $2
         group by "profileBuilderId", "profileBuilderVersion"`,
        [opts.profileBuilderId, version]
      );
      if (res.rowCount === 1) {
        return {
          status: res.rows[0].lastTimestamp ? "ready" : "building",
          version,
          startedAt: res.rows[0].startedAt,
          totalUsers: parseInt(res.rows[0].totalUsers),
          processedUsers: parseInt(res.rows[0].processedUsers),
          errorUsers: parseInt(res.rows[0].errorUsers),
          speed: parseFloat(res.rows[0].speed),
        };
      }
      return { status: "unknown", version };
    } catch (e: any) {
      return { status: "error", error: e.message };
    }
  }
}
