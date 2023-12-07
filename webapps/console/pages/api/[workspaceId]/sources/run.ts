import { z } from "zod";
import { createRoute, getUser, verifyAccess } from "../../../../lib/api";
import { SessionUser } from "../../../../lib/schema";
import { ApiError } from "../../../../lib/shared/errors";
import { getServerLog } from "../../../../lib/server/log";

import { scheduleSync } from "../../../../lib/server/sync";

const log = getServerLog("sync-run");

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

export default createRoute()
  .GET({
    auth: false,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
      fullSync: z.string().optional(),
    }),
    result: resultType,
  })
  .handler(async ({ query, req, res }) => {
    const { workspaceId } = query;
    //Since we need custom auth for request coming from scheduler, we need to set auth: false,
    //and add custom auth logic here
    const syncAuthKey = process.env.SYNCCTL_AUTH_KEY ?? "";
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
      fullSync: query.fullSync === "true" || query.fullSync === "1",
      syncId: query.syncId as string,
    });
  })
  .toNextApiHandler();
