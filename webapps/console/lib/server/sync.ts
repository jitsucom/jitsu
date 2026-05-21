import { db } from "./db";
import { ConfigurationObject, ConfigurationObjectLink } from "@prisma/client";
import { CronExpressionParser } from "cron-parser";
import { hash as juavaHash, LogFactory, randomId, requireDefined, rpc } from "juava";
import { getServerLog } from "./log";
import { getAppEndpoint } from "../domains";
import { NextApiRequest } from "next";
import { eeAuthHeaders, getEeConnection, isEEAvailable } from "./ee";
import { DestinationConfig, ServiceConfig, SessionUser } from "../schema";
import { randomUUID } from "crypto";
import { tryManageOauthCreds } from "./oauth/services";
import { DestinationType, getCoreDestinationType } from "../schema/destinations";
import omit from "lodash/omit";
import { FunctionLogger, SetOpts, Store, SyncFunction } from "@jitsu/protocols/functions";
import { mixpanelFacebookAdsSync, mixpanelGoogleAdsSync } from "./syncs/mixpanel";
import hash from "stable-hash";
import { clickhouse } from "./clickhouse";
import { initStream } from "../sources";
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

export async function cleanupTasksLogs(syncId: string) {
  const syncTaskLogAge = serverEnv.SYNC_TASK_LOG_AGE ?? 60;
  const syncTaskLogSize = serverEnv.SYNC_TASK_LOG_SIZE ?? 3000;

  await db.pgPool().query(
    `DELETE FROM newjitsu.source_task t
                           WHERE sync_id = $1 AND
                             started_at < (SELECT
                                             GREATEST(min(started_at), now() - interval '${syncTaskLogAge} days') AS cutoff_date
                                           FROM (
                                                  SELECT started_at
                                                  FROM newjitsu.source_task
                                                  WHERE sync_id = $1
                                                  ORDER BY started_at DESC
                                                  OFFSET ${syncTaskLogSize}
                                                    LIMIT 1
                                                ) sub)`,
    [syncId]
  );
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
}): Promise<ScheduleSyncError | undefined> {
  try {
    const { host } = getEeConnection();
    const quotaCheck = `${host}api/quotas/sync`;
    let authHeaders: Record<string, string>;
    if (opts.user) {
      //manual run — forward the user's Firebase credential
      authHeaders = eeAuthHeaders(opts.req);
    } else {
      //scheduled run (triggered by syncctl) — no signed-in user; authenticate
      //to ee-api with the static service token
      const serviceToken = requireDefined(serverEnv.EE_API_SERVICE_TOKEN, `env EE_API_SERVICE_TOKEN is not set`);
      authHeaders = { Authorization: `Bearer ${serviceToken}` };
    }
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
        const taskId = randomUUID();
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

export async function catalogFromDb(packageName: string, version: string, storageKey: string) {
  const res = await db.pgPool().query(
    `select catalog
            from newjitsu.source_catalog
            where key = $1
              and package = $2
              and version = $3`,
    [storageKey, packageName, version]
  );
  if (res.rowCount === 1) {
    return res.rows[0].catalog;
  } else {
    return null;
  }
}

export function selectStreamsFromCatalog(catalog: any, syncOptions: any): any {
  const selectedStreams: Record<string, any> = syncOptions?.streams || {};
  const disabledStreams: Record<string, any> = syncOptions?.disabledStreams || {};
  const schemaChanges = syncOptions?.schemaChanges;
  const hasIncremental = Object.values(selectedStreams).some((s: any) => s.sync_mode === "incremental");

  const streams = catalog.streams
    .filter((s: any) => {
      const name = s.namespace ? s.namespace + "." + s.name : s.name;
      return !!selectedStreams[name] || (schemaChanges === "streams" && !disabledStreams[name]);
    })
    .map((s: any) => {
      const name = s.namespace ? s.namespace + "." + s.name : s.name;
      let stream = selectedStreams[name];
      if (!stream) {
        stream = initStream(s, hasIncremental ? "incremental" : "full_refresh");
      }
      return {
        ...omit(stream, "table_name"),
        destination_sync_mode: "overwrite",
        stream: {
          ...s,
          table_name: stream.table_name,
        },
      };
    });
  return { streams };
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

function createDatabaseLogger(taskId: string, syncId: string): FunctionLogger {
  return {
    debug: async (message: string) => {
      await dbLog({
        taskId,
        syncId,
        message,
        level: "DEBUG",
      });
    },
    info: async (message: string) => {
      await dbLog({
        taskId,
        syncId,
        message,
        level: "INFO",
      });
    },
    error: async (message: string) => {
      await dbLog({
        taskId,
        syncId,
        message,
        level: "ERROR",
      });
    },
    warn: async (message: string) => {
      await dbLog({
        taskId,
        syncId,
        message,
        level: "WARN",
      });
    },
  };
}

type SaasSyncState = {
  dict: Record<
    string,
    {
      value: any;
      //ISO date
      expireAt?: string;
    }
  >;
};

function createDatabaseStore(taskId: string, syncId: string): Store {
  const stream = "cloud-sync";

  async function getSaasSyncState(): Promise<SaasSyncState> {
    return ((await db.prisma().source_state.findFirst({ where: { sync_id: syncId, stream } }))?.state || {
      dict: {},
    }) as SaasSyncState;
  }

  async function saveSaasSyncState(state: SaasSyncState) {
    await db.prisma().source_state.upsert({
      where: { sync_id_stream: { sync_id: syncId, stream } },
      create: {
        sync_id: syncId,
        stream,
        state,
      },
      update: {
        state,
      },
    });
  }

  return {
    del: async (key: string): Promise<void> => {
      const state = await getSaasSyncState();
      delete state.dict[key];
      await saveSaasSyncState(state);
    },
    get: async (key: string): Promise<any> => {
      return (await getSaasSyncState()).dict[key]?.value;
    },
    set: async (key: string, value: any, opts?: SetOpts): Promise<void> => {
      if (opts) {
        throw new Error("Custom TTLs are not supported for Cloud Syncs sync");
      }
      const state = await getSaasSyncState();
      state.dict[key] = { value };
      await saveSaasSyncState(state);
    },
    ttl: (key: string): Promise<number> => Promise.reject(new Error("Not implemented")),
  };
}

function getImplemetingFunction(pkg: string, destinationType: DestinationType): SyncFunction {
  if (destinationType.id === "mixpanel" && pkg === "airbyte/source-google-ads") {
    return mixpanelGoogleAdsSync as any;
  } else if (destinationType.id === "mixpanel" && pkg === "airbyte/source-facebook-marketing") {
    return mixpanelFacebookAdsSync as any;
  }

  throw new Error(`${pkg} -> ${destinationType.id} sync doesn't exist`);
}

async function runSyncSynchronously({
  syncId,
  taskId,
  destinationConfig,
  destinationType,
  sourceConfig,
  startedBy,
}: {
  syncId: string;
  taskId: string;
  destinationType: DestinationType;
  destinationConfig: DestinationConfig;
  sourceConfig: ServiceConfig;
  startedBy: any;
}) {
  await createOrUpdateTask({
    taskId,
    syncId,
    startedBy,
    status: "RUNNING",
    description: "Started",
    pkg: sourceConfig.package,
    version: sourceConfig.version,
  });
  const syncConfig = destinationType?.syncs?.[sourceConfig.package];
  if (!syncConfig) {
    await createOrUpdateTask({
      taskId,
      syncId,
      startedBy,
      status: "FAILED",
      description: `Sync function not found for package ${sourceConfig.package}`,
      pkg: sourceConfig.package,
      version: sourceConfig.version,
    });
    return;
  }
  await dbLog({
    taskId,
    syncId,
    message: `Running sync from ${sourceConfig.package} -> ${destinationType.title} (#${destinationType.id})`,
    level: "INFO",
  });
  const credentials = await tryManageOauthCreds(sourceConfig);

  const implementingFunction = getImplemetingFunction(sourceConfig.package, destinationType);
  await dbLog({
    taskId,
    syncId,
    level: "INFO",
    message: `Successfully connected to to ${sourceConfig.package}. Running sync`,
  });

  await implementingFunction({
    source: {
      package: sourceConfig.package,
      credentials,
      syncProps: sourceConfig,
    },
    destination: destinationConfig,
    ctx: {
      log: createDatabaseLogger(taskId, syncId),
      store: createDatabaseStore(taskId, syncId),
    },
  });

  await createOrUpdateTask({
    taskId,
    syncId,
    startedBy,
    status: "SUCCESS",
    description: "Successfully finished",
    pkg: sourceConfig.package,
    version: sourceConfig.version,
  });
}

function safeStringify(e: any) {
  try {
    return JSON.stringify(e, null, 2);
  } catch (e) {
    return e?.toString();
  }
}

export async function scheduleSync({
  workspaceId,
  syncIdOrModel,
  user,
  trigger = "manual",
  req,
  fullSync,
  ignoreRunning,
  skipRefresh,
  nodelay,
  taskId,
}: {
  workspaceId: string;
  syncIdOrModel: string | SyncDatabaseModel;
  trigger?: "manual" | "scheduled";
  user?: SessionUser;
  req: NextApiRequest;
  fullSync?: boolean;
  ignoreRunning?: boolean;
  skipRefresh?: boolean;
  nodelay?: boolean;
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
        } workspaceId=${workspaceId} trigger=${trigger} taskId=${taskId} skipRefresh=${!!skipRefresh} fullSync=${!!fullSync} ignoreRunning=${!!ignoreRunning} nodelay=${!!nodelay}`
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
    const destinationConfig = sync.to.config as DestinationConfig;
    const destinationType = getCoreDestinationType(destinationConfig.destinationType);
    const serviceConfig = { ...(service.config as any), ...service };
    const runSynchronously = !(destinationType.usesBulker || destinationType.id === "webhook") && destinationType.syncs;
    // for normal scheduled syncs syncctl handles 'already running' case
    if (trigger === "manual" || runSynchronously) {
      const running = await db.prisma().source_task.findFirst({
        where: {
          sync_id: syncIdOrModel as string,
          status: "RUNNING",
        },
      });

      if (running) {
        const msInMin = 1000 * 60;
        if (ignoreRunning || (runSynchronously && Date.now() - running.updated_at.getTime() >= 2 * msInMin)) {
          await dbLog({
            taskId: running.task_id,
            syncId: sync.id,
            message: `Synchronous task ${running.task_id} was running due to timeout`,
            level: "ERROR",
          });
          await db.prisma().source_task.update({
            where: {
              task_id: running.task_id,
            },
            data: {
              status: "FAILED",
              updated_at: new Date(),
            },
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
        package: (service.config as any).package,
        version: (service.config as any).version,
        startedBy,
      });
      if (checkResult) {
        return checkResult;
      }
    }
    let stateObj: any = undefined;
    if (fullSync) {
      await db.prisma().source_state.deleteMany({
        where: {
          sync_id: sync.id,
        },
      });
    } else {
      stateObj = await loadState(sync);
    }
    if (runSynchronously) {
      const started = Date.now();
      try {
        await runSyncSynchronously({
          taskId,
          syncId: sync.id,
          destinationConfig,
          destinationType,
          sourceConfig: serviceConfig,
          startedBy,
        });
        const time = Date.now() - started;
        await dbLog({
          taskId,
          syncId: sync.id,
          message: `Sync finished in ${time}ms`,
          level: "INFO",
        });
      } catch (e: any) {
        log
          .atError()
          .log(`Error running task ${taskId}, sync ${sync.id}. Message : ${e?.message}`, JSON.stringify(e, null, 2));
        const syncError = `${e?.message || safeStringify(e)}`;
        await createOrUpdateTask({
          taskId,
          syncId: sync.id,
          status: "FAILED",
          startedBy,
          description: `Error running sync: ${syncError}`,
          pkg: serviceConfig.package,
          version: serviceConfig.version,
        });
        await dbLog({
          taskId,
          syncId: sync.id,
          message: `Error running sync: ${syncError}${e?.stack ? `\n${e.stack}` : ""}`,
          level: "ERROR",
        });
      }
      return {
        ok: true,
        taskId,
        status: `${appBase}/api/${workspaceId}/sources/tasks?taskId=${taskId}&syncId=${syncIdOrModel}`,
        logs: `${appBase}/api/${workspaceId}/sources/logs?taskId=${taskId}&syncId=${syncIdOrModel}`,
      };
    }
    if (destinationType.id === "clickhouse" && !destinationConfig.provisioned) {
      destinationConfig.loadAsJson = false;
    }

    const h = juavaHash("md5", hash(serviceConfig.credentials));
    const versionHash = `${workspaceId}_${serviceConfig.id}_${h}`;

    const catalog = await catalogFromDb(serviceConfig.package, serviceConfig.version, versionHash);
    if (!catalog) {
      log
        .atWarn()
        .log(
          `scheduleSync: source_catalog miss for sync=${sync.id} package=${serviceConfig.package}@${serviceConfig.version} versionHash=${versionHash} — discover did not persist a catalog row matching this key`
        );
      return {
        ok: false,
        error: `Source catalog not found or outdated. Please run Refresh Catalog in Sync settings`,
      };
    }
    const configuredCatalog = selectStreamsFromCatalog(catalog, sync.data);
    if (
      serviceConfig.package === "airbyte/source-postgres" ||
      serviceConfig.package === "airbyte/source-mssql" ||
      serviceConfig.package === "airbyte/source-singlestore"
    ) {
      // default value 10000 is too low for big tables - leading to very slow syncs
      serviceConfig.credentials.sync_checkpoint_records = 200000;
    }
    let res: any;
    const schemaChanges = (sync.data as any).schemaChanges;
    log
      .atInfo()
      .log(
        `scheduleSync dispatch: sync=${sync.id} task=${taskId} branch=${
          !skipRefresh && (schemaChanges === "fields" || schemaChanges === "streams") ? "discover" : "read"
        } schemaChanges=${schemaChanges ?? "-"} skipRefresh=${!!skipRefresh}`
      );
    if (!skipRefresh && (schemaChanges === "fields" || schemaChanges === "streams")) {
      res = await rpc(syncURL + "/discover", {
        method: "POST",
        body: {
          config: await tryManageOauthCreds({ ...serviceConfig, id: sync.fromId }),
        },
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        query: {
          package: serviceConfig.package,
          version: serviceConfig.version,
          storageKey: versionHash,
          thenRun: "true",
          taskId,
          syncId: sync.id,
          workspaceId: workspaceId,
          fullSync: fullSync ? "true" : "false",
          startedBy: JSON.stringify(startedBy),
        },
      });
    } else {
      res = await rpc(syncURL + "/read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        query: {
          package: serviceConfig.package,
          version: serviceConfig.version,
          taskId,
          syncId: sync.id,
          fullSync: fullSync ? "true" : "false",
          startedBy: JSON.stringify(startedBy),
          namespace: typeof sync.data?.["namespace"] !== "undefined" ? sync.data?.["namespace"] : "${LEGACY}",
          toSameCase: sync.data?.["toSameCase"] ? "true" : "false",
          addMeta: sync.data?.["addMeta"] ? "true" : "false",
          deduplicate: sync.data?.["deduplicate"] ?? true ? "true" : "false",
          nodelay: nodelay ? "true" : "false",
          tableNamePrefix: sync.data?.["tableNamePrefix"] ?? "",
          ...(serverEnv.DEBUG_SYNCS ? { debug: "true" } : {}),
        },
        body: {
          config: await tryManageOauthCreds({ ...serviceConfig, id: sync.fromId }),
          catalog: configuredCatalog,
          ...(stateObj ? { state: stateObj } : {}),
          destinationConfig,
          functionsEnv: sync.data?.["functionsEnv"],
        },
      });
    }
    if (!res.ok) {
      log
        .atWarn()
        .log(
          `scheduleSync: syncctl RPC returned not-ok for sync=${sync.id} task=${taskId}: ${
            res.error ?? "unknown error"
          }`
        );
      return { ok: false, error: res.error ?? "unknown error", taskId };
    } else {
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
    }
  } catch (e: any) {
    return syncError(log, `Error running sync`, e, false, `sync: ${syncIdOrModel} workspace: ${workspaceId}`);
  }
}

async function loadState(sync: SyncDatabaseModel): Promise<any> {
  //load state from db
  const stateRows = await db.prisma().source_state.findMany({
    where: {
      sync_id: sync.id,
    },
  });
  if (stateRows.length > 0) {
    if (stateRows.length === 1 && stateRows[0].stream === "_LEGACY_STATE") {
      //legacy state
      return stateRows[0].state;
    } else if (stateRows.length === 1 && stateRows[0].stream === "_GLOBAL_STATE") {
      //v2 global state
      return [
        {
          type: "GLOBAL",
          global: stateRows[0].state,
        },
      ];
    } else {
      //v2 multi-stream states
      return stateRows
        .filter(r => r.stream !== "_LEGACY_STATE" && r.stream != "_GLOBAL_STATE")
        .filter(r => ((sync.data as any).streams || {})[r.stream]?.sync_mode !== "full_refresh")
        .map(r => {
          const descr = r.stream.split(".");
          let namespace: string | undefined = undefined;
          let name: string | undefined = undefined;
          if (descr.length === 1) {
            name = descr[0];
          } else if (descr.length === 2) {
            namespace = descr[0];
            name = descr[1];
          } else {
            throw new Error(`Invalid stream name ${r.stream}`);
          }
          return {
            type: "STREAM",
            stream: {
              stream_descriptor: { name: name, namespace: namespace },
              stream_state: r.state,
            },
          };
        });
    }
  }
  return undefined;
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
