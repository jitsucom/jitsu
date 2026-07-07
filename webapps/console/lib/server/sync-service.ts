import type { PrismaClient } from "@prisma/client";
import type { Pool } from "pg";
import type { ClickHouseClient } from "@clickhouse/client";
import type { NextApiRequest } from "next";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { hash as juavaHash, requireDefined, rpc } from "juava";
import stableHash from "stable-hash";
import { SessionUser } from "../schema";
import { verifyAccess } from "../api";
import { ApiError } from "../shared/errors";
import { scheduleSync, ScheduleSyncResult, syncError } from "./sync";
import { getServerEnv } from "./serverEnv";
import { getServerLog } from "./log";

dayjs.extend(utc);

const log = getServerLog("sync-service");

export interface SyncServiceDeps {
  prisma: PrismaClient;
  pgPool: Pool;
  clickhouse: ClickHouseClient;
}

const TASKS_LIMIT = 50;
const LOGS_DEFAULT_LIMIT = 200;
const LOGS_MAX_LIMIT = 5000;

export type SyncOpResult = { ok: boolean; error?: string; pending?: boolean; [key: string]: any };

/**
 * Source-sync lifecycle operations (run/cancel/tasks/logs), connector introspection
 * (spec/discover), source credential checks, and saved-state inspection — extracted from the
 * `pages/api/[workspaceId]/sources/*` route handlers so the MCP server shares one
 * implementation of workspace scoping and syncctl dispatch.
 *
 * Spec, discover, and source checks are async on the sync controller: the first call kicks the
 * job off and returns `{ ok: false, pending: true }`; callers poll until `ok` flips to true or
 * `error` is set. `scheduleSync` and `syncError` are shared helpers that reach for singletons
 * internally (same pattern as ConfigObjectsService).
 */
export class SyncService {
  private readonly prisma: PrismaClient;
  private readonly pgPool: Pool;
  private readonly clickhouse: ClickHouseClient;

  constructor(deps: SyncServiceDeps) {
    this.prisma = deps.prisma;
    this.pgPool = deps.pgPool;
    this.clickhouse = deps.clickhouse;
  }

  private syncctl(): { url: string; authHeaders: Record<string, string> } {
    const serverEnv = getServerEnv();
    const url = requireDefined(
      serverEnv.SYNCCTL_URL,
      `env SYNCCTL_URL is not set. Sync Controller is required to run sources`
    );
    const syncAuthKey = serverEnv.SYNCCTL_AUTH_KEY ?? "";
    return { url, authHeaders: syncAuthKey ? { Authorization: `Bearer ${syncAuthKey}` } : {} };
  }

  private async getSync(workspaceId: string, syncId: string) {
    return this.prisma.configurationObjectLink.findFirst({
      where: { workspaceId, id: syncId, deleted: false, type: "sync" },
    });
  }

  /**
   * Load a service (source connector config) scoped to the workspace and merge the db row over
   * its config — same shape `sources/discover.ts` posts to syncctl. Returns the merged object
   * plus the credentials-derived storage key used by the async check/discover result tables.
   */
  private async getServiceWithStorageKey(workspaceId: string, serviceId: string) {
    const row = await this.prisma.configurationObject.findFirst({
      where: { id: serviceId, workspaceId, type: "service", deleted: false },
    });
    if (!row) {
      throw new ApiError(`service with id ${serviceId} not found in the workspace`, {}, { status: 404 });
    }
    const service = { ...(row.config as any), ...row } as any;
    const h = juavaHash("md5", stableHash(service.credentials));
    return { service, storageKey: `${workspaceId}_${service.id}_${h}` };
  }

  /** Mirrors `sources/run.ts` (manual trigger). Delegates to the shared `scheduleSync`. */
  async runSync(
    user: SessionUser,
    workspaceId: string,
    opts: { syncId: string; fullSync?: boolean; ignoreRunning?: boolean },
    req: NextApiRequest
  ): Promise<ScheduleSyncResult> {
    await verifyAccess(user, workspaceId);
    return scheduleSync({
      req,
      user,
      trigger: "manual",
      workspaceId,
      syncIdOrModel: opts.syncId,
      fullSync: !!opts.fullSync,
      ignoreRunning: !!opts.ignoreRunning,
    });
  }

  /** Mirrors `sources/cancel.ts`. Cancellation is async — poll `listSyncTasks` for CANCELLED. */
  async cancelSync(
    user: SessionUser,
    workspaceId: string,
    opts: { syncId: string; taskId: string }
  ): Promise<SyncOpResult> {
    await verifyAccess(user, workspaceId);
    const sync = await this.prisma.configurationObjectLink.findFirst({
      where: { workspaceId, id: opts.syncId, deleted: false },
      include: { from: true },
    });
    if (!sync) {
      return { ok: false, error: `sync with id ${opts.syncId} not found in the workspace` };
    }
    const { url, authHeaders } = this.syncctl();
    try {
      const res = await rpc(url + "/cancel", {
        method: "GET",
        headers: { "Content-Type": "application/json", ...authHeaders },
        query: {
          workspaceId,
          syncId: opts.syncId,
          taskId: opts.taskId,
          package: (sync.from?.config as any)?.package ?? "",
        },
      });
      if (!res.ok) {
        return { ok: false, error: res.error ?? "unknown error" };
      }
      return { ok: true, status: "cancellation requested — poll tasks until the task shows CANCELLED" };
    } catch (e: any) {
      return syncError(log, `Error cancelling sync job`, e, false, `syncId: ${opts.syncId} taskId: ${opts.taskId}`);
    }
  }

  /** Mirrors `sources/tasks.ts` GET (without the per-task logs URL — use `getSyncLogs`). */
  async listSyncTasks(
    user: SessionUser,
    workspaceId: string,
    opts: { syncId?: string; taskId?: string; status?: string; from?: Date | string; to?: Date | string } = {}
  ): Promise<SyncOpResult> {
    await verifyAccess(user, workspaceId);
    if (opts.syncId) {
      const sync = await this.getSync(workspaceId, opts.syncId);
      if (!sync) {
        return { ok: false, error: `Sync ${opts.syncId} not found` };
      }
    }
    try {
      let i = 1;
      let sql =
        'select st.* from newjitsu.source_task st join newjitsu."ConfigurationObjectLink" link on st.sync_id = link.id where link."workspaceId" = $1';
      const args: any[] = [workspaceId];
      const addFilter = (clause: string, value: any) => {
        sql += ` and ${clause} $${++i}`;
        args.push(value);
      };
      if (opts.syncId) addFilter("st.sync_id =", opts.syncId);
      if (opts.taskId) addFilter("st.task_id =", opts.taskId);
      if (opts.status) addFilter("st.status =", opts.status);
      if (opts.from) addFilter("st.started_at >=", dayjs(opts.from).utc().toDate());
      if (opts.to) addFilter("st.started_at <", dayjs(opts.to).utc().toDate());
      sql += ` order by st.started_at desc limit ${TASKS_LIMIT}`;
      const tasks = await this.prisma.$queryRawUnsafe<any[]>(sql, ...args);
      if (opts.taskId) {
        if (tasks.length === 0) {
          return { ok: false, error: `Task ${opts.taskId} not found` };
        }
        return { ok: true, task: tasks[0] };
      }
      return { ok: true, tasks };
    } catch (e: any) {
      return syncError(log, `Error loading tasks`, e, false, `sync: ${opts.syncId} workspace: ${workspaceId}`);
    }
  }

  /**
   * Task logs as structured rows, newest first — the non-streaming counterpart of
   * `sources/logs.ts` (which gzips a text stream). Reads ClickHouse `task_log` and falls back
   * to the Postgres copy when ClickHouse has nothing for the task.
   */
  async getSyncLogs(
    user: SessionUser,
    workspaceId: string,
    opts: { syncId: string; taskId: string; limit?: number }
  ): Promise<SyncOpResult> {
    await verifyAccess(user, workspaceId);
    const sync = await this.prisma.configurationObjectLink.findFirst({
      where: { workspaceId, id: opts.syncId, deleted: false },
    });
    if (!sync) {
      return { ok: false, error: `sync with id ${opts.syncId} not found in the workspace` };
    }
    const limit = Math.min(Math.max(opts.limit ?? LOGS_DEFAULT_LIMIT, 1), LOGS_MAX_LIMIT);
    const rs = await this.clickhouse.query({
      query: `select timestamp, level, logger, message from task_log
         where task_id = {taskId:String} and sync_id = {syncId:String}
         order by timestamp desc limit {limit:UInt32}`,
      query_params: { taskId: opts.taskId, syncId: opts.syncId, limit },
      format: "JSONEachRow",
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    let logs = (await rs.json()) as { timestamp: string; level: string; logger: string; message: string }[];
    if (logs.length === 0) {
      const pgRes = await this.pgPool.query(
        `select tl.timestamp, tl.level, tl.logger, tl.message
           from newjitsu.task_log tl join newjitsu."ConfigurationObjectLink" link on tl.sync_id = link.id
           where tl.task_id = $1 and link."workspaceId" = $2
           order by tl.timestamp desc limit $3`,
        [opts.taskId, workspaceId, limit]
      );
      logs = pgRes.rows;
    }
    if (logs.length === 0) {
      const task = await this.prisma.source_task.findFirst({ where: { task_id: opts.taskId } });
      const note = !task || task.status === "RUNNING" ? "The task is starting..." : "No logs found for this task";
      return { ok: true, logs: [], note };
    }
    return { ok: true, logs };
  }

  /** Mirrors `sources/spec.ts`. Async: poll until `ok: true` and `specs` is set. */
  async getConnectorSpec(
    user: SessionUser,
    workspaceId: string,
    opts: { package: string; version: string; force?: boolean }
  ): Promise<SyncOpResult> {
    await verifyAccess(user, workspaceId);
    const { url, authHeaders } = this.syncctl();
    try {
      const res = await this.pgPool.query(
        `select specs, error from newjitsu.source_spec where package = $1 and version = $2`,
        [opts.package, opts.version]
      );
      let error;
      // force=true must re-fetch from the controller even when a cached spec
      // row exists — otherwise a tag rebuilt in place keeps serving stale specs.
      if (res.rowCount === 1 && !opts.force) {
        const specs = res.rows[0].specs;
        if (specs) {
          return { ok: true, specs };
        }
        error = res.rows[0].error ?? "unknown error";
        if (error === "pending") {
          return { ok: false, pending: true };
        }
      }
      if (!res.rowCount || opts.force) {
        const checkRes = await rpc(url + "/spec", {
          method: "GET",
          headers: { "Content-Type": "application/json", ...authHeaders },
          query: { package: opts.package, version: opts.version },
        });
        if (!checkRes.ok) {
          return { ok: false, error: checkRes.error ?? "unknown error" };
        }
        await this.pgPool.query(
          `insert into newjitsu.source_spec as s (package, version, specs, timestamp, error)
             values ($1, $2, null, $3, $4)
             ON CONFLICT ON CONSTRAINT source_spec_pkey DO UPDATE SET specs = null, timestamp = $3, error = $4`,
          [opts.package, opts.version, new Date(), "pending"]
        );
        return { ok: false, pending: true };
      }
      return error ? { ok: false, error } : { ok: false, pending: true };
    } catch (e: any) {
      return syncError(log, `Error loading specs`, e, false, `source: ${opts.package}:${opts.version}`);
    }
  }

  /** Mirrors `sources/discover.ts`. Async: poll until `ok: true` and `catalog` is set. */
  async discoverStreams(
    user: SessionUser,
    workspaceId: string,
    opts: { serviceId: string; refresh?: boolean; force?: boolean }
  ): Promise<SyncOpResult> {
    await verifyAccess(user, workspaceId);
    const { url, authHeaders } = this.syncctl();
    try {
      const { service, storageKey } = await this.getServiceWithStorageKey(workspaceId, opts.serviceId);
      if (!opts.force) {
        const cached = await this.catalogFromDb({ storageKey, package: service.package, version: service.version });
        if (cached && (cached.pending || !opts.refresh)) {
          return cached;
        }
      }
      const discoverQueryRes = await rpc(url + "/discover", {
        method: "POST",
        // Pass the source-config wrapper through unchanged. syncctl's
        // oauth-refresh init container handles Nango refresh inside the Pod.
        body: { source: service },
        headers: { "Content-Type": "application/json", ...authHeaders },
        query: { package: service.package, version: service.version, storageKey },
      });
      if (!discoverQueryRes.ok) {
        return { ok: false, error: discoverQueryRes.error ?? "unknown error" };
      }
      await this.pgPool.query(
        `INSERT INTO newjitsu.source_catalog (package, version, key, timestamp, status, description)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT ON CONSTRAINT source_catalog_pkey DO UPDATE SET timestamp = $4, status=$5, description=$6`,
        [service.package, service.version, storageKey, new Date(), "RUNNING", "RUNNING"]
      );
      return { ok: false, pending: true };
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      return syncError(log, `Error running discover`, e, false, `source: ${opts.serviceId} workspace: ${workspaceId}`);
    }
  }

  private async catalogFromDb(key: {
    storageKey: string;
    package: string;
    version: string;
  }): Promise<SyncOpResult | undefined> {
    const res = await this.pgPool.query(
      `select catalog, status, description from newjitsu.source_catalog where key = $1 and package = $2 and version = $3`,
      [key.storageKey, key.package, key.version]
    );
    if (res.rowCount !== 1) {
      return undefined;
    }
    const { status, catalog, description } = res.rows[0];
    switch (status) {
      case "SUCCESS":
        return { ok: true, catalog };
      case "RUNNING":
        return { ok: false, pending: true };
      default:
        return { ok: false, error: description };
    }
  }

  /**
   * Trigger the async credentials check for an existing service (mirrors `sources/check.ts`
   * POST, but reads the stored — unmasked — config instead of taking one from the caller).
   * Returns the `storageKey` to poll via `getSourceCheckResult`.
   */
  async triggerSourceCheck(user: SessionUser, workspaceId: string, serviceId: string): Promise<SyncOpResult> {
    await verifyAccess(user, workspaceId);
    const { url, authHeaders } = this.syncctl();
    const { service, storageKey } = await this.getServiceWithStorageKey(workspaceId, serviceId);
    try {
      const checkRes = await rpc(url + "/check", {
        method: "POST",
        body: { source: service },
        headers: { "Content-Type": "application/json", ...authHeaders },
        query: { package: service.package, version: service.version, storageKey },
      });
      if (!checkRes.ok) {
        return { ok: false, error: checkRes.error ?? "unknown error" };
      }
      return { ok: false, pending: true, storageKey };
    } catch (e: any) {
      return syncError(log, `Error running connection check`, e, false, `source: ${serviceId}`);
    }
  }

  /** Mirrors `sources/check.ts` GET: SUCCESS → ok, row with error → error, no row yet → pending. */
  async getSourceCheckResult(user: SessionUser, workspaceId: string, storageKey: string): Promise<SyncOpResult> {
    await verifyAccess(user, workspaceId);
    if (!storageKey.startsWith(workspaceId)) {
      return { ok: false, error: "storageKey doesn't belong to the current workspace" };
    }
    try {
      const res = await this.pgPool.query(`select status, description from newjitsu.source_check where key = $1`, [
        storageKey,
      ]);
      if (res.rowCount === 1) {
        return res.rows[0].status === "SUCCESS" ? { ok: true } : { ok: false, error: res.rows[0].description };
      }
      return { ok: false, pending: true };
    } catch (e: any) {
      return syncError(log, `Error running connection check`, e, false, `source: ${storageKey}`);
    }
  }

  /** Mirrors `sources/state.ts` GET — saved cursor per stream. */
  async getSyncState(user: SessionUser, workspaceId: string, syncId: string): Promise<SyncOpResult> {
    await verifyAccess(user, workspaceId);
    const sync = await this.getSync(workspaceId, syncId);
    if (!sync) {
      return { ok: false, error: "sync not found" };
    }
    try {
      return { ok: true, state: await this.loadState(syncId) };
    } catch (e: any) {
      return syncError(log, `Error loading state`, e, false, `source: ${syncId} workspace: ${workspaceId}`);
    }
  }

  /**
   * Reset the saved cursor (mirrors `sources/state.ts` POST with an empty body). `stream`
   * omitted → drops the state of every stream, so the next run is a full re-sync.
   */
  async resetSyncState(
    user: SessionUser,
    workspaceId: string,
    opts: { syncId: string; stream?: string }
  ): Promise<SyncOpResult> {
    await verifyAccess(user, workspaceId);
    const sync = await this.getSync(workspaceId, opts.syncId);
    if (!sync) {
      return { ok: false, error: "sync not found" };
    }
    const running = await this.prisma.source_task.findFirst({ where: { sync_id: opts.syncId, status: "RUNNING" } });
    if (running) {
      return { ok: false, error: "Sync is running. Please make sure that sync is stopped before editing state." };
    }
    try {
      if (opts.stream) {
        await this.pgPool.query(`delete from newjitsu.source_state where sync_id = $1 and stream = $2`, [
          opts.syncId,
          opts.stream,
        ]);
      } else {
        await this.pgPool.query(`delete from newjitsu.source_state where sync_id = $1`, [opts.syncId]);
      }
      return { ok: true, state: await this.loadState(opts.syncId) };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  private async loadState(syncId: string): Promise<Record<string, string>> {
    const res = await this.pgPool.query(`select stream, state from newjitsu.source_state where sync_id = $1`, [syncId]);
    return Object.fromEntries(res.rows.map(r => [r.stream, JSON.stringify(r.state, null, 2)]));
  }
}
