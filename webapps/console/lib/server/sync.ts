import { CloudSchedulerClient } from "@google-cloud/scheduler";
import { db } from "./db";
import { ConfigurationObject, ConfigurationObjectLink } from "@prisma/client";
import { hash as juavaHash, LogFactory, randomId, requireDefined, rpc, stopwatch } from "juava";
import { google } from "@google-cloud/scheduler/build/protos/protos";
import { difference } from "lodash";
import { getServerLog } from "./log";
import { getAppEndpoint } from "../domains";
import { NextApiRequest } from "next";
import { createJwt, getEeConnection, isEEAvailable } from "./ee";
import { DestinationConfig, ServiceConfig, SessionUser } from "../schema";
import { randomUUID } from "crypto";
import { tryManageOauthCreds } from "./oauth/services";
import { DestinationType, getCoreDestinationType } from "../schema/destinations";
import omit from "lodash/omit";
import { FunctionLogger, SetOpts, Store, SyncFunction } from "@jitsu/protocols/functions";
import { mixpanelFacebookAdsSync, mixpanelGoogleAdsSync } from "./syncs/mixpanel";
import IJob = google.cloud.scheduler.v1.IJob;
import hash from "stable-hash";
import { clickhouse } from "./clickhouse";
import { SyncDbModel } from "../../pages/api/[workspaceId]/config/link";
const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";
const clickhouseUploadS3Bucket = process.env.CLICKHOUSE_UPLOAD_S3_BUCKET;
const s3Region = process.env.S3_REGION;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const clickhouseS3Configured = clickhouseUploadS3Bucket && s3Region && s3AccessKeyId && s3SecretAccessKey;

const log = getServerLog("sync-scheduler");

const googleSchedulerLocation = process.env.GOOGLE_SCHEDULER_LOCATION || "us-central1";
const googleScheduler = createGoogleSchedulerClient();

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
    table: metricsSchema + ".task_log",
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
}: {
  taskId: string;
  syncId: string;
  status: string;
  startedBy: any;
  description: string;
}) {
  const taskData = {
    sync_id: syncId,
    task_id: taskId,
    status,
    started_at: new Date(),
    updated_at: new Date(),
    started_by: startedBy,
    description,
    package: "jitsu",
    version: "0.0.1",
  };
  await db.prisma().source_task.upsert({
    where: { task_id: taskId },
    create: taskData,
    update: omit(taskData, "task_id"),
  });
}

export async function checkQuota(opts: {
  user?: SessionUser;
  trigger: "manual" | "scheduled";
  workspaceId: string;
  syncId: string;
  package: string;
  version: string;
  startedBy: any;
}): Promise<ScheduleSyncError | undefined> {
  try {
    const quotaCheck = `${getEeConnection().host}api/quotas/sync`;
    let eeAuthToken: string | undefined;
    if (opts.user) {
      eeAuthToken = createJwt(opts.user.internalId, opts.user.email, opts.workspaceId, 60).jwt;
    } else {
      //automatic run, authorized via syncctl auth key. Authorize as admin
      eeAuthToken = createJwt("admin-service-account@jitsu.com", "admin-service-account@jitsu.com", "$all", 60).jwt;
    }
    const quotaCheckResult = await rpc(quotaCheck, {
      method: "POST",
      query: { workspaceId: opts.workspaceId, trigger: opts.trigger }, //db is created, so the slug won't be really used
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${eeAuthToken}`,
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
  const res = await db
    .pgPool()
    .query(`select catalog from newjitsu.source_catalog where key = $1 and package = $2 and version = $3`, [
      storageKey,
      packageName,
      version,
    ]);
  if (res.rowCount === 1) {
    return res.rows[0].catalog;
  } else {
    return null;
  }
}

export function selectStreamsFromCatalog(catalog: any, selectedStreams: any): any {
  const streams = catalog.streams
    .filter((s: any) => !!selectedStreams[s.namespace ? s.namespace + "." + s.name : s.name])
    .map((s: any) => {
      const stream = selectedStreams[s.namespace ? s.namespace + "." + s.name : s.name];
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
  });
  const syncConfig = destinationType?.syncs?.[sourceConfig.package];
  if (!syncConfig) {
    await createOrUpdateTask({
      taskId,
      syncId,
      startedBy,
      status: "FAILED",
      description: `Sync function not found for package ${sourceConfig.package}`,
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
    description: "Succesfully finished",
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
}: {
  workspaceId: string;
  syncIdOrModel: string | SyncDatabaseModel;
  trigger?: "manual" | "scheduled";
  user?: SessionUser;
  req: NextApiRequest;
  fullSync?: boolean;
  ignoreRunning?: boolean;
}): Promise<ScheduleSyncResult> {
  const syncAuthKey = process.env.SYNCCTL_AUTH_KEY ?? "";
  const taskId = randomUUID();
  const syncURL = requireDefined(
    process.env.SYNCCTL_URL,
    `env SYNCCTL_URL is not set. Sync Controller is required to run sources`
  );
  const startedBy =
    trigger === "manual" ? (user ? { trigger: "manual", ...user } : { trigger: "manual" }) : { trigger: "scheduled" };
  const authHeaders: any = {};
  if (syncAuthKey) {
    authHeaders["Authorization"] = `Bearer ${syncAuthKey}`;
  }
  try {
    const appBase = getAppEndpoint(req).baseUrl;
    const sync = typeof syncIdOrModel === "string" ? await getSyncById(syncIdOrModel, workspaceId) : syncIdOrModel;
    if (!sync) {
      return {
        ok: false,
        error: `Sync ${syncIdOrModel} not found`,
      };
    }
    const service = sync.from;
    if (!service) {
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
      //load state from db
      const stateRows = await db.prisma().source_state.findMany({
        where: {
          sync_id: sync.id,
        },
      });
      if (stateRows.length > 0) {
        if (stateRows.length === 1 && stateRows[0].stream === "_LEGACY_STATE") {
          //legacy state
          stateObj = stateRows[0].state;
        } else if (stateRows.length === 1 && stateRows[0].stream === "_GLOBAL_STATE") {
          //v2 global state
          stateObj = [
            {
              type: "GLOBAL",
              global: stateRows[0].state,
            },
          ];
        } else {
          //v2 multi-stream states
          stateObj = stateRows
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
    if (
      destinationType.id === "clickhouse" &&
      destinationConfig.loadAsJson &&
      !destinationConfig.provisioned &&
      clickhouseS3Configured
    ) {
      destinationConfig.s3Region = s3Region;
      destinationConfig.s3AccessKeyId = s3AccessKeyId;
      destinationConfig.s3SecretAccessKey = s3SecretAccessKey;
      destinationConfig.s3Bucket = clickhouseUploadS3Bucket;
      destinationConfig.s3UsePresignedURL = true;
    }

    const h = juavaHash("md5", hash(serviceConfig.credentials));
    const versionHash = `${workspaceId}_${serviceConfig.id}_${h}`;

    const catalog = await catalogFromDb(serviceConfig.package, serviceConfig.version, versionHash);
    if (!catalog) {
      return {
        ok: false,
        error: `Source catalog not found or outdated. Please run Refresh Catalog in Sync settings`,
      };
    }
    const configuredCatalog = selectStreamsFromCatalog(catalog, (sync.data as any).streams);
    if (
      serviceConfig.package === "airbyte/source-postgres" ||
      serviceConfig.package === "airbyte/source-mssql" ||
      serviceConfig.package === "airbyte/source-singlestore"
    ) {
      // default value 10000 is to low for big tables - leading to very slow syncs
      serviceConfig.credentials.sync_checkpoint_records = 200000;
    }
    const res = await rpc(syncURL + "/read", {
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
        tableNamePrefix: sync.data?.["tableNamePrefix"] ?? "",
      },
      body: {
        config: await tryManageOauthCreds({ ...serviceConfig, id: sync.fromId }),
        catalog: configuredCatalog,
        ...(stateObj ? { state: stateObj } : {}),
        destinationConfig,
        functionsEnv: sync.data?.["functionsEnv"],
      },
    });
    if (!res.ok) {
      return { ok: false, error: res.error ?? "unknown error", taskId };
    } else {
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

export async function updateScheduler(baseUrl: string, sync: SyncDbModel) {
  if (!googleScheduler) {
    return;
  }
  const sw = stopwatch();
  const parent = googleScheduler.locationPath(await googleScheduler.getProjectId(), googleSchedulerLocation);
  const job: IJob = {
    name: googleScheduler.jobPath(await googleScheduler.getProjectId(), googleSchedulerLocation, sync.id),
    schedule: sync.data?.schedule,
    timeZone: sync.data?.timezone ?? "Etc/UTC",
    httpTarget: {
      uri: `${baseUrl}/api/${sync.workspaceId}/sources/run?syncId=${sync.id}`,
      headers: {
        Authorization: `Bearer ${process.env.SYNCCTL_AUTH_KEY}`,
      },
      httpMethod: "GET",
    },
  };
  log.atInfo().log(`Updating job ${job.name}`);
  try {
    await googleScheduler.updateJob({ job });
    log.atInfo().log("Update scheduler took", sw.elapsedPretty());
  } catch (e: any) {
    if (e.message.includes("NOT_FOUND") || e.message.includes("INVALID_ARGUMENT:")) {
      log.atInfo().log(`Creating job ${job.name}`);
      await googleScheduler.createJob({ job, parent });
      log.atInfo().log("Create scheduler took", sw.elapsedPretty());
    } else {
      log.atError().log(`Error updating job ${job.name}`, e);
      throw new Error(`Error updating scheduler`, { cause: e });
    }
  }
}

export async function createScheduler(baseUrl: string, sync: SyncDbModel) {
  if (!googleScheduler) {
    return;
  }
  const sw = stopwatch();
  const parent = googleScheduler.locationPath(await googleScheduler.getProjectId(), googleSchedulerLocation);
  const job: IJob = {
    name: googleScheduler.jobPath(await googleScheduler.getProjectId(), googleSchedulerLocation, sync.id),
    schedule: sync.data?.schedule,
    timeZone: sync.data?.timezone ?? "Etc/UTC",
    httpTarget: {
      uri: `${baseUrl}/api/${sync.workspaceId}/sources/run?syncId=${sync.id}`,
      headers: {
        Authorization: `Bearer ${process.env.SYNCCTL_AUTH_KEY}`,
      },
      httpMethod: "GET",
    },
  };
  log.atInfo().log(`Creating job ${job.name}`);
  try {
    await googleScheduler.createJob({ job, parent });
    log.atInfo().log("Create scheduler took", sw.elapsedPretty());
  } catch (e: any) {
    if (e.message.includes("ALREADY_EXISTS")) {
      log.atInfo().log(`Updating job ${job.name}`);
      await googleScheduler.updateJob({ job });
      log.atInfo().log("Updating scheduler took", sw.elapsedPretty());
    } else {
      log.atError().log(`Error creating job ${job.name}`, e);
      throw new Error(`Error creating scheduler`, { cause: e });
    }
  }
}

export async function deleteScheduler(syncId: string) {
  if (!googleScheduler) {
    return;
  }
  const sw = stopwatch();

  const jobName = googleScheduler.jobPath(await googleScheduler.getProjectId(), googleSchedulerLocation, syncId);
  log.atInfo().log(`Deleting job ${jobName}`);
  try {
    await googleScheduler.deleteJob({ name: jobName });
    log.atInfo().log("Delete scheduler took", sw.elapsedPretty());
  } catch (e: any) {
    if (!e.message.includes("NOT_FOUND")) {
      log.atError().log(`Error deleting job ${jobName}`, e);
      throw new Error(`Error deleting scheduler`, { cause: e });
    }
  }
}

export async function syncWithScheduler(baseUrl: string) {
  const sw = stopwatch();
  if (!googleScheduler) {
    log.atInfo().log(`GoogleCloudScheduler sync: GOOGLE_SCHEDULER_KEY is not defined, skipping`);
    return;
  }
  const gsParent = googleScheduler.locationPath(await googleScheduler.getProjectId(), googleSchedulerLocation);

  const allSyncs = await db.prisma().configurationObjectLink.findMany({
    where: {
      type: "sync",
      deleted: false,
      workspace: { deleted: false },
      from: { deleted: false },
      to: { deleted: false },
    },
  });
  const syncs = allSyncs.filter(sync => !!(sync.data as any).schedule);
  const syncsById = syncs.reduce((acc, sync) => {
    acc[sync.id] = sync;
    return acc;
  }, {} as Record<string, any>);

  const iterable = googleScheduler.listJobsAsync({
    parent: gsParent,
  });
  const jobsById: Record<string, IJob> = {};
  for await (const response of iterable) {
    jobsById[(response.name ?? "").replace(`${gsParent}/jobs/`, "")] = response;
  }

  const syncsIds = Object.keys(syncsById);
  const jobsIds = Object.keys(jobsById);
  const idsToCreate = difference(syncsIds, jobsIds);
  const idsToDelete = difference(jobsIds, syncsIds);
  const idsToUpdate = difference(syncsIds, idsToCreate);
  log
    .atInfo()
    .log(
      `GoogleCloudScheduler sync: ${idsToCreate.length} to create, ${idsToDelete.length} to delete, ${idsToUpdate.length} to update`
    );
  for (const id of idsToCreate) {
    const sync = syncsById[id];
    const schedule = (sync.data as any).schedule;
    const job: IJob = {
      name: `${gsParent}/jobs/${id}`,
      schedule: schedule,
      timeZone: (sync.data as any).timezone ?? "Etc/UTC",
      httpTarget: {
        uri: `${baseUrl}/api/${sync.workspaceId}/sources/run?syncId=${sync.id}`,
        headers: {
          Authorization: `Bearer ${process.env.SYNCCTL_AUTH_KEY}`,
        },
        httpMethod: "GET",
      },
    };
    log.atInfo().log(`Creating job ${job.name}`);
    try {
      await googleScheduler.createJob({
        parent: gsParent,
        job: job,
      });
    } catch (e: any) {
      log.atError().log(`Error creating job ${job.name}`, e);
      if (e.message.includes("ALREADY_EXISTS")) {
        await googleScheduler.updateJob({
          job,
        });
      } else {
        throw e;
      }
    }
  }
  for (const id of idsToDelete) {
    const job = jobsById[id];
    log.atInfo().log(`Deleting job ${job.name}`);
    try {
      await googleScheduler.deleteJob({
        name: job.name ?? "",
      });
    } catch (e: any) {
      log.atError().log(`Error deleting job ${job.name}`, e);
      if (!e.message.includes("NOT_FOUND")) {
        throw e;
      }
    }
  }
  for (const id of idsToUpdate) {
    const sync = syncsById[id];
    const schedule = (sync.data as any).schedule;
    const job = jobsById[id];
    const syncTimezone = (sync.data as any).timezone ?? "Etc/UTC";
    if (job.schedule !== schedule || job.timeZone !== syncTimezone) {
      log.atInfo().log(`Updating job ${job.name}`);
      await googleScheduler.updateJob({
        job: {
          ...job,
          schedule: schedule,
          timeZone: syncTimezone,
        },
      });
    }
  }
  getServerLog().atInfo().log("Sync with GoogleCloudScheduler took", sw.elapsedPretty());
}

function createGoogleSchedulerClient(): CloudSchedulerClient | undefined {
  const googleSchedulerKeyJson = process.env.GOOGLE_SCHEDULER_KEY;
  if (!googleSchedulerKeyJson) {
    log.atWarn().log(`GoogleCloudScheduler sync: GOOGLE_SCHEDULER_KEY is not defined. Sync scheduler is disabled`);
    return;
  }
  const googleSchedulerKey = JSON.parse(googleSchedulerKeyJson);
  const googleSchedulerProjectId = googleSchedulerKey.project_id;

  const client = new CloudSchedulerClient({
    credentials: googleSchedulerKey,
    projectId: googleSchedulerProjectId,
  });
  // client.getProjectId();
  // client.locationPath();
  return client;
}

// export async function syncWithK8SCronJob(baseUrl: string) {
//   const sw = stopwatch();
//   const allSyncs = await db.prisma().configurationObjectLink.findMany({
//     where: { type: "sync", deleted: false },
//   });
//   const syncs = allSyncs.filter(sync => !!(sync.data as any).schedule);
//   const syncsById = syncs.reduce((acc, sync) => {
//     acc[sync.id] = sync;
//     return acc;
//   }, {} as Record<string, any>);
//
//   const client = new CloudSchedulerClient({
//     credentials: googleSchedulerKey,
//     projectId: googleSchedulerProjectId,
//   });
//   const iterable = client.listJobsAsync({
//     parent: googleSchedulerParent,
//   });
//   const jobsById: Record<string, IJob> = {};
//   for await (const response of iterable) {
//     jobsById[(response.name ?? "").replace(`${googleSchedulerParent}/jobs/`, "")] = response;
//   }
//
//   const syncsIds = Object.keys(syncsById);
//   const jobsIds = Object.keys(jobsById);
//   const idsToCreate = difference(syncsIds, jobsIds);
//   const idsToDelete = difference(jobsIds, syncsIds);
//   const idsToUpdate = difference(syncsIds, idsToCreate);
//   log
//     .atInfo()
//     .log(
//       `GoogleCloudScheduler sync: ${idsToCreate.length} to create, ${idsToDelete.length} to delete, ${idsToUpdate.length} to update`
//     );
//   for (const id of idsToCreate) {
//     const sync = syncsById[id];
//     const schedule = (sync.data as any).schedule;
//     const job: IJob = {
//       name: `${googleSchedulerParent}/jobs/${id}`,
//       schedule: schedule,
//       timeZone: (sync.data as any).timezone ?? "Etc/UTC",
//       httpTarget: {
//         uri: `${baseUrl}/api/${sync.workspaceId}/sources/run?syncId=${sync.id}`,
//         headers: {
//           Authorization: `Bearer ${process.env.SYNCCTL_AUTH_KEY}`,
//         },
//         httpMethod: "GET",
//       },
//     };
//     log.atInfo().log(`Creating job ${job.name}`);
//     await client.createJob({
//       parent: googleSchedulerParent,
//       job: job,
//     });
//   }
//   for (const id of idsToDelete) {
//     const job = jobsById[id];
//     log.atInfo().log(`Deleting job ${job.name}`);
//     await client.deleteJob({
//       name: job.name ?? "",
//     });
//   }
//   for (const id of idsToUpdate) {
//     const sync = syncsById[id];
//     const schedule = (sync.data as any).schedule;
//     const job = jobsById[id];
//     const syncTimezone = (sync.data as any).timezone ?? "Etc/UTC";
//     if (job.schedule !== schedule || job.timeZone !== syncTimezone) {
//       log.atInfo().log(`Updating job ${job.name}`);
//       await client.updateJob({
//         job: {
//           ...job,
//           schedule: schedule,
//           timeZone: syncTimezone,
//         },
//       });
//     }
//   }
//   getServerLog().atInfo().log("Sync with GoogleCloudScheduler took", sw.elapsedPretty());
// }
