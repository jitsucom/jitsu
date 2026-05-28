import { db } from "./db";
import { ConfigurationObject, ConfigurationObjectLink } from "@prisma/client";
import { CronExpressionParser } from "cron-parser";
import { LogFactory, randomId, requireDefined, rpc } from "juava";
import { getServerLog } from "./log";
import { getAppEndpoint } from "../domains";
import { NextApiRequest } from "next";
import { eeAuthHeadersOrServiceToken, getEeConnection, isEEAvailable } from "./ee";
import { SessionUser } from "../schema";
import { randomUUID } from "crypto";
import omit from "lodash/omit";
import { clickhouse } from "./clickhouse";
import { getServerEnv } from "./serverEnv";

const serverEnv = getServerEnv();

const log = getServerLog("sync-scheduler");

export type ScheduleSyncError = { ok: false; error: string; [key: string]: any };
export type ScheduleSyncSuccess = { ok: true; taskId: string; [key: string]: any };
export type ScheduleSyncResult = ScheduleSyncError | ScheduleSyncSuccess;

export const syncError = (
  log: LogFactory,
  message: string,
  error: any,
  mask: boolean = false,
  ...privateArgs: any[]
): ScheduleSyncError => {
  const errorId = randomId(8);
  const publicMessage = mask
    ? `Internal server error. Please contact support. Error ID: ${errorId}`
    : `${message}. Error ${errorId}: ${error}.`;
  log
    .atError()
    .withCause(error)
    .log(message, `Error ID: ${errorId}`, ...privateArgs);
  return {
    ok: false,
    error: publicMessage,
  };
};

async function dbLog({
  taskId,
  syncId,
  message,
  level,
}: {
  taskId: string;
  message: string;
  syncId: string;
  level: string;
}) {
  log.at(level).log(`Task ${taskId} sync ${syncId}: ${message}`);
  await clickhouse.insert({
    table: "task_log",
    format: "JSON",
    clickhouse_settings: {
      async_insert_busy_timeout_ms: 1000,
      async_insert: 1,
      wait_for_async_insert: 0,
    },
    values: {
      timestamp: new Date().getTime(),
      logger: "sync",
      task_id: taskId,
      sync_id: syncId,
      message,
      level,
    },
  });
}

async function createOrUpdateTask({
  taskId,
  syncId,
  status,
  startedBy,
  description,
  pkg = "jitsu",
  version = "0.0.1",
}: {
  taskId: string;
  syncId: string;
  status: string;
  startedBy: any;
  description: string;
  pkg?: string;
  version?: string;
}) {
  const taskData = {
    sync_id: syncId,
    task_id: taskId,
    status,
    started_at: new Date(),
    updated_at: new Date(),
    started_by: startedBy,
    description,
    package: pkg,
    version: version,
  };
  await db.prisma().source_task.upsert({
    where: { task_id: taskId },
    create: taskData,
    update: omit(taskData, "task_id"),
  });
}

export async function checkQuota(opts: {
  user?: SessionUser;
  req: NextApiRequest;
  trigger: "manual" | "scheduled";
  workspaceId: string;
  syncId: string;
  package: string;
  version: string;
  startedBy: any;
  // Optional caller-supplied taskId. Used by the autonomous CronJob path's
  // quota-check init container so the SKIPPED row in source_task uses the
  // pod's actual task id instead of a freshly-generated UUID.
  taskId?: string;
}): Promise<ScheduleSyncError | undefined> {
  try {
    const { host } = getEeConnection();
    const quotaCheck = `${host}api/quotas/sync`;
    // Forward the Firebase cookie only when the inbound caller was actually
    // authenticated by Firebase (`user.authType === "firebase"`). API-key
    // / OIDC / scheduler callers go through the service token regardless of
    // any cookie they might have attached — see eeAuthHeadersOrServiceToken.
    const authHeaders = eeAuthHeadersOrServiceToken(opts.req, opts.user);
    const quotaCheckResult = await rpc(quotaCheck, {
      method: "POST",
      query: { workspaceId: opts.workspaceId, trigger: opts.trigger }, //db is created, so the slug won't be really used
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
    });
    if (!quotaCheckResult.ok) {
      if (!opts.user) {
        const taskId = opts.taskId ?? randomUUID();
        //scheduled run. We need to create a failed task so user can see the error
        await createOrUpdateTask({
          taskId,
          syncId: opts.syncId,
          status: "SKIPPED",
          startedBy: opts.startedBy,
          description: `Quota exceeded: ${quotaCheckResult.error}`,
          pkg: opts.package,
          version: opts.version,
        });
        await dbLog({
          taskId,
          syncId: opts.syncId,
          message: `Quota exceeded: ${quotaCheckResult.error}`,
          level: "ERROR",
        });
      }
      return {
        ok: false,
        error: `Quota exceeded: ${quotaCheckResult.error}`,
        errorType: "quota_exceeded",
      };
    }
  } catch (e) {
    log.atError().log("Error checking quota", e);
    //ignore this error and proceed with the run. If billing server is down, we don't want to spoil the user experience
  }
}

export type SyncDatabaseModel = ConfigurationObjectLink & { from: ConfigurationObject; to: ConfigurationObject };

export async function getSyncById(syncId: string, workspaceId: string): Promise<SyncDatabaseModel | undefined> {
  return (
    (await db.prisma().configurationObjectLink.findFirst({
      where: {
        id: syncId,
        workspaceId: workspaceId,
        deleted: false,
        type: "sync",
        workspace: { deleted: false },
        from: { deleted: false, workspaceId: workspaceId },
        to: { deleted: false, workspaceId: workspaceId },
      },
      include: {
        from: true,
        to: true,
      },
    })) || undefined
  );
}

export async function scheduleSync({
  workspaceId,
  syncIdOrModel,
  user,
  trigger = "manual",
  req,
  fullSync,
  ignoreRunning,
  taskId,
}: {
  workspaceId: string;
  syncIdOrModel: string | SyncDatabaseModel;
  trigger?: "manual" | "scheduled";
  user?: SessionUser;
  req: NextApiRequest;
  fullSync?: boolean;
  ignoreRunning?: boolean;
  taskId?: string;
}): Promise<ScheduleSyncResult> {
  const syncAuthKey = serverEnv.SYNCCTL_AUTH_KEY ?? "";
  taskId = taskId || randomUUID();
  const syncURL = requireDefined(
    serverEnv.SYNCCTL_URL,
    `env SYNCCTL_URL is not set. Sync Controller is required to run sources`
  );
  const startedBy =
    trigger === "manual" ? (user ? { trigger: "manual", ...user } : { trigger: "manual" }) : { trigger: "scheduled" };
  const authHeaders: any = {};
  if (syncAuthKey) {
    authHeaders["Authorization"] = `Bearer ${syncAuthKey}`;
  }
  try {
    log
      .atInfo()
      .log(
        `scheduleSync entry: syncId=${
          typeof syncIdOrModel === "string" ? syncIdOrModel : (syncIdOrModel as any)?.id
        } workspaceId=${workspaceId} trigger=${trigger} taskId=${taskId} fullSync=${!!fullSync} ignoreRunning=${!!ignoreRunning}`
      );
    const appBase = getAppEndpoint(req).baseUrl;
    const sync = typeof syncIdOrModel === "string" ? await getSyncById(syncIdOrModel, workspaceId) : syncIdOrModel;
    if (!sync) {
      log.atWarn().log(`scheduleSync: sync ${syncIdOrModel} not found (workspace ${workspaceId})`);
      return {
        ok: false,
        error: `Sync ${syncIdOrModel} not found`,
      };
    }
    const service = sync.from;
    if (!service) {
      log.atWarn().log(`scheduleSync: sync ${sync.id} has no service (from); aborting`);
      return {
        ok: false,
        error: `Service ${sync.from} not found`,
      };
    }
    const serviceConfig = service.config as any;
    // Manual triggers still admission-gate on a pre-existing RUNNING row to
    // avoid double-starting a sync (the scheduled bearer path skips this
    // because syncctl handles the already-running case itself).
    if (trigger === "manual") {
      const running = await db.prisma().source_task.findFirst({
        where: {
          sync_id: syncIdOrModel as string,
          status: "RUNNING",
        },
      });

      if (running) {
        if (ignoreRunning) {
          // Cancel the stale/in-flight task row before proceeding — otherwise
          // the next manual run without ignoreRunning sees the same RUNNING
          // row and rejects with "Sync is already running" until the 1h
          // stale-task sweep eventually closes it.
          await db.prisma().source_task.update({
            where: { task_id: running.task_id },
            data: { status: "CANCELLED", updated_at: new Date() },
          });
        } else {
          return {
            ok: false,
            error: `Sync is already running`,
            runningTask: {
              taskId: running.task_id,
              status: `${appBase}/api/${workspaceId}/sources/tasks?taskId=${running.task_id}&syncId=${syncIdOrModel}`,
              logs: `${appBase}/api/${workspaceId}/sources/logs?taskId=${running.task_id}&syncId=${syncIdOrModel}`,
            },
          };
        }
      }
    }

    if (isEEAvailable()) {
      const checkResult = await checkQuota({
        user,
        req,
        trigger,
        workspaceId,
        syncId: sync.id,
        package: serviceConfig.package,
        version: serviceConfig.version,
        startedBy,
      });
      if (checkResult) {
        return checkResult;
      }
    }
    // fullSync: console still purges saved state directly. Syncctl's
    // load-catalog-state init reads source_state from the DB; deleting here
    // makes the next read start fresh without needing a new syncctl param.
    if (fullSync) {
      await db.prisma().source_state.deleteMany({
        where: { sync_id: sync.id },
      });
    }

    // Thin proxy: post to syncctl /read with just enough query params for it
    // to look up the SyncEntry from its repository (syncId + updatedAt for
    // parity wait). syncctl runs oauth-refresh + load-catalog-state + the
    // optional discover init container as part of the Pod itself — console
    // no longer touches OAuth creds, catalog DB, or stream selection.
    const res = await rpc(syncURL + "/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
      },
      query: {
        syncId: sync.id,
        updatedAt: sync.updatedAt.toISOString(),
        taskId,
        fullSync: fullSync ? "true" : "false",
        startedBy: JSON.stringify(startedBy),
        ...(serverEnv.DEBUG_SYNCS ? { debug: "true" } : {}),
      },
    });

    if (!res.ok) {
      log
        .atWarn()
        .log(
          `scheduleSync: syncctl RPC returned not-ok for sync=${sync.id} task=${taskId}: ${
            res.error ?? "unknown error"
          }`
        );
      return { ok: false, error: res.error ?? "unknown error", taskId };
    }
    if (trigger === "manual") {
      await createOrUpdateTask({
        taskId,
        syncId: sync.id,
        startedBy,
        status: "RUNNING",
        description: "Started",
        pkg: serviceConfig.package,
        version: serviceConfig.version,
      });
    }
    return {
      ok: true,
      taskId,
      status: `${appBase}/api/${workspaceId}/sources/tasks?taskId=${taskId}&syncId=${syncIdOrModel}`,
      logs: `${appBase}/api/${workspaceId}/sources/logs?taskId=${taskId}&syncId=${syncIdOrModel}`,
    };
  } catch (e: any) {
    return syncError(log, `Error running sync`, e, false, `sync: ${syncIdOrModel} workspace: ${workspaceId}`);
  }
}

/**
 * Validate sync.data.schedule (5-field cron expression) and sync.data.timezone
 * (IANA tz name) before persisting a sync. Throws an Error with a user-facing
 * message on invalid input.
 *
 * Used by the link.ts POST/PUT handler. Previously the GCS scheduler API
 * implicitly rejected invalid schedules at write time; with the move to
 * syncctl-managed CronJobs, k8s rejects them later (in syncctl reconcile
 * logs) with no API feedback to the user. This restores the synchronous
 * write-time check.
 *
 * Empty/missing schedule means "manual-only sync" — not an error.
 */
export function validateSyncSchedule(data: { schedule?: string; timezone?: string } | undefined | null): void {
  if (!data) return;
  const schedule = data.schedule?.trim();
  if (!schedule) return; // manual-only sync, no schedule to validate

  // Reject the legacy "Disabled" sentinel that older UI code may still emit
  // as the value "" — already handled above. Also reject obvious junk early
  // before letting cron-parser produce a less-clear error.
  if (schedule.startsWith("@")) {
    // cron-parser supports @yearly/@monthly/@weekly/@daily/@hourly etc.;
    // pass through to the parser. k8s CronJob spec ALSO accepts these per
    // batch/v1 cron schedule format.
  }

  const tz = data.timezone?.trim() || "Etc/UTC";
  // Validate IANA tz name first so the error message is targeted; cron-parser
  // would otherwise just throw "Invalid timezone" without saying which one.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`Invalid timezone "${tz}". Use an IANA tz name like "America/New_York" or "Etc/UTC".`);
  }

  try {
    CronExpressionParser.parse(schedule, { tz });
  } catch (e: any) {
    throw new Error(`Invalid cron schedule "${schedule}": ${e?.message || e}`);
  }
}
