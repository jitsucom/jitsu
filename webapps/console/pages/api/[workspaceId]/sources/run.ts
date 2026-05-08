import { z } from "zod";
import { createRoute, getUser, verifyAccess } from "../../../../lib/api";
import { SessionUser } from "../../../../lib/schema";
import { ApiError } from "../../../../lib/shared/errors";
import { getServerLog } from "../../../../lib/server/log";

import { cleanupTasksLogs, scheduleSync } from "../../../../lib/server/sync";
import { isTruish, stopwatch } from "juava";
import { getServerEnv } from "../../../../lib/server/serverEnv";

const log = getServerLog("sync-run");
const serverEnv = getServerEnv();

const resultType = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
  errorType: z.string().optional(),
  taskId: z.string().optional(),
  status: z.string().optional(),
  logs: z.string().optional(),
  runningTask: z
    .object({
      taskId: z.string(),
      status: z.string(),
      logs: z.string(),
    })
    .optional(),
});

export const route = createRoute()
  .GET({
    auth: false,
    summary: "Run sync",
    description:
      "Schedules a sync (the connection between a service and a destination, identified by `syncId`) to run immediately. " +
      "Returns the new `taskId` plus `status` and `logs` URLs to poll. " +
      "If a task is already running, the call fails and returns `runningTask` pointing at the in-flight job. " +
      "Pass `fullSync=true` to drop the saved cursor and re-sync from scratch.\n\n" +
      "Auth: bearer token (`<keyId>:<secret>`). Internal scheduler calls authenticate with the sync-controller key instead.",
    tags: ["sync"],
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
      fullSync: z.string().optional(),
      ignoreRunning: z.string().transform(isTruish).optional(),
      skipRefresh: z.string().transform(isTruish).optional(),
      nodelay: z.string().transform(isTruish).optional(),
      taskId: z.string().optional(),
    }),
    result: resultType,
  })
  .handler(async ({ query, req, res }) => {
    try {
      const { workspaceId } = query;
      //Since we need custom auth for request coming from scheduler, we need to set auth: false,
      //and add custom auth logic here
      const syncAuthKey = serverEnv.SYNCCTL_AUTH_KEY ?? "";
      const token = req.headers.authorization ?? "";
      let user: SessionUser | undefined;
      let trigger: "scheduled" | "manual" = "scheduled";
      if (token.replace("Bearer ", "") !== syncAuthKey || !token || !syncAuthKey) {
        //not a call from scheduler, check ordinary auth
        trigger = "manual";
        user = await getUser(res, req);
        if (!user) {
          throw new ApiError("Authorization Required", {}, { status: 401 });
        }
        await verifyAccess(user, workspaceId);
      }
      return await scheduleSync({
        req,
        user,
        trigger,
        workspaceId,
        fullSync: isTruish(query.fullSync),
        syncIdOrModel: query.syncId as string,
        ignoreRunning: !!query.ignoreRunning,
        skipRefresh: !!query.skipRefresh,
        nodelay: !!query.nodelay,
        taskId: query.taskId,
      });
    } finally {
      const sw = stopwatch();
      await cleanupTasksLogs(query.syncId);
      log.atInfo().log(`Cleanup tasks logs took ${sw.elapsedPretty()}`);
    }
  });

export default route.toNextApiHandler();

export const config = {
  maxDuration: 300,
  memory: 400,
};
