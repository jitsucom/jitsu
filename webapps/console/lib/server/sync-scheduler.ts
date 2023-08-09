import { CloudSchedulerClient } from "@google-cloud/scheduler";
import { db } from "./db";
import { requireDefined } from "juava";
import { google } from "@google-cloud/scheduler/build/protos/protos";
import IJob = google.cloud.scheduler.v1.IJob;
import { difference } from "lodash";
import { getServerLog } from "./log";

const log = getServerLog("sync-scheduler");

export async function syncWithScheduler(baseUrl: string) {
  const googleSchedulerKeyJson = process.env.GOOGLE_SCHEDULER_KEY;
  if (!googleSchedulerKeyJson) {
    log.atInfo().log(`GoogleCloudScheduler sync: GOOGLE_SCHEDULER_KEY is not defined, skipping`);
    return;
  }
  const googleSchedulerKey = JSON.parse(googleSchedulerKeyJson);
  const googleSchedulerProjectId = googleSchedulerKey.project_id;
  const googleSchedulerLocation = requireDefined(
    process.env.GOOGLE_SCHEDULER_LOCATION,
    "env GOOGLE_SCHEDULER_LOCATION is not defined"
  );
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
}
