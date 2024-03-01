import { CloudSchedulerClient } from "@google-cloud/scheduler";
import { db } from "./db";
import { ConfigurationObject, ConfigurationObjectLink } from "@prisma/client";
import { LogFactory, randomId, requireDefined, rpc, stopwatch } from "juava";
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
  await db.prisma().task_log.create({
    data: {
      timestamp: new Date(),
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
  description,
}: {
  taskId: string;
  syncId: string;
  status: string;
  description: string;
}) {
  const taskData = {
    sync_id: syncId,
    task_id: taskId,
    status,
    started_at: new Date(),
    updated_at: new Date(),
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
  workspaceId: string;
  syncId: string;
  package: string;
  version: string;
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
      query: { workspaceId: opts.workspaceId }, //db is created, so the slug won't be really used
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
          status: "FAILED",
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
        ...stream,
        destination_sync_mode: "overwrite",
        stream: s,
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
}: {
  syncId: string;
  taskId: string;
  destinationType: DestinationType;
  destinationConfig: DestinationConfig;
  sourceConfig: ServiceConfig;
}) {
  await createOrUpdateTask({
    taskId,
    syncId,
    status: "RUNNING",
    description: "Started",
  });
  const syncConfig = destinationType?.syncs?.[sourceConfig.package];
  if (!syncConfig) {
    await createOrUpdateTask({
      taskId,
      syncId,
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
    status: "SUCCESS",
    description: "Succesfully finished",
  });
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
  const authHeaders: any = {};
  if (syncAuthKey) {
    trigger = "scheduled";
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
    const running = await db.prisma().source_task.findFirst({
      where: {
        sync_id: syncIdOrModel as string,
        status: "RUNNING",
      },
    });
    const runSynchronously = !destinationType.usesBulker && destinationType.syncs;
    if (running) {
      const msInMin = 1000 * 60;
      if (ignoreRunning || (runSynchronously && Date.now() - running.updated_at.getTime() >= 2 * msInMin)) {
        await db.prisma().task_log.create({
          data: {
            timestamp: new Date(),
            logger: "sync",
            task_id: running.task_id,
            sync_id: sync.id,
            message: `Synchronous task ${running.task_id} was running due to timeout`,
            level: "ERROR",
          }
        })
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


    if (isEEAvailable()) {
      const checkResult = await checkQuota({
        user,
        workspaceId,
        syncId: sync.id,
        package: (service.config as any).package,
        version: (service.config as any).version,
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
        await createOrUpdateTask({
          taskId,
          syncId: sync.id,
          status: "FAILED",
          description: `Error running sync: ${e?.message}`,
        });
        await dbLog({
          taskId,
          syncId: sync.id,
          message: `Error running sync: ${e?.message}\n${e?.stack}`,
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

    const catalog = await catalogFromDb(serviceConfig.package, serviceConfig.version, (sync.data as any).storageKey);
    if (!catalog) {
      return {
        ok: false,
        error: `Catalog not found. Please run Refresh Catalog in Sync settings`,
      };
    }
    const configuredCatalog = selectStreamsFromCatalog(catalog, (sync.data as any).streams);

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
        syncIdOr: sync.id,
        startedBy: trigger === "manual" ? (user ? user.internalId : "manual") : "scheduled",
        tableNamePrefix: sync.data?.["tableNamePrefix"] ?? "",
      },
      body: {
        config: await tryManageOauthCreds({ ...serviceConfig, id: sync.fromId }),
        catalog: configuredCatalog,
        ...(stateObj ? { state: stateObj } : {}),
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

export async function syncWithScheduler(baseUrl: string) {
  const sw = stopwatch();
  const googleSchedulerKeyJson = process.env.GOOGLE_SCHEDULER_KEY;
  if (!googleSchedulerKeyJson) {
    log.atInfo().log(`GoogleCloudScheduler sync: GOOGLE_SCHEDULER_KEY is not defined, skipping`);
    return;
  }
  const googleSchedulerKey = JSON.parse(googleSchedulerKeyJson);
  const googleSchedulerProjectId = googleSchedulerKey.project_id;
  const googleSchedulerLocation = process.env.GOOGLE_SCHEDULER_LOCATION || "us-central1";
  const googleSchedulerParent = `projects/${googleSchedulerProjectId}/locations/${googleSchedulerLocation}`;

  const allSyncs = await db.prisma().configurationObjectLink.findMany({
    where: { type: "sync", deleted: false },
  });
  const syncs = allSyncs.filter(sync => !!(sync.data as any).schedule);
  const syncsById = syncs.reduce((acc, sync) => {
    acc[sync.id] = sync;
    return acc;
  }, {} as Record<string, any>);

  const client = new CloudSchedulerClient({
    credentials: googleSchedulerKey,
    projectId: googleSchedulerProjectId,
  });
  const iterable = client.listJobsAsync({
    parent: googleSchedulerParent,
  });
  const jobsById: Record<string, IJob> = {};
  for await (const response of iterable) {
    jobsById[(response.name ?? "").replace(`${googleSchedulerParent}/jobs/`, "")] = response;
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
      name: `${googleSchedulerParent}/jobs/${id}`,
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
    await client.createJob({
      parent: googleSchedulerParent,
      job: job,
    });
  }
  for (const id of idsToDelete) {
    const job = jobsById[id];
    log.atInfo().log(`Deleting job ${job.name}`);
    await client.deleteJob({
      name: job.name ?? "",
    });
  }
  for (const id of idsToUpdate) {
    const sync = syncsById[id];
    const schedule = (sync.data as any).schedule;
    const job = jobsById[id];
    const syncTimezone = (sync.data as any).timezone ?? "Etc/UTC";
    if (job.schedule !== schedule || job.timeZone !== syncTimezone) {
      log.atInfo().log(`Updating job ${job.name}`);
      await client.updateJob({
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
