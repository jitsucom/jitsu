import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { requireDefined, rpc } from "juava";
import { randomUUID } from "crypto";
import { tryManageOauthCreds } from "../../../../lib/server/oauth/services";
import { ServiceConfig } from "../../../../lib/schema";
import { syncError } from "../../../../lib/shared/errors";
import { getServerLog } from "../../../../lib/server/log";
import { getAppEndpoint } from "../../../../lib/domains";

const log = getServerLog("sync-run");

const resultType = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
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
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query, req }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    const syncURL = requireDefined(
      process.env.SYNCCTL_URL,
      `env SYNCCTL_URL is not set. Sync Controller is required to run sources`
    );
    const syncAuthKey = process.env.SYNCCTL_AUTH_KEY ?? "";
    const authHeaders: any = {};
    if (syncAuthKey) {
      authHeaders["Authorization"] = `Bearer ${syncAuthKey}`;
    }
    try {
      const sync = await db.prisma().configurationObjectLink.findFirst({
        where: {
          id: query.syncId as string,
          workspaceId: workspaceId,
          deleted: false,
          type: "sync",
        },
        include: {
          from: true,
        },
      });
      if (!sync) {
        return {
          ok: false,
          error: `Sync ${query.syncId} not found`,
        };
      }
      const running = await db.prisma().source_task.findFirst({
        where: {
          sync_id: query.syncId as string,
          status: "RUNNING",
        },
      });
      if (running) {
        return {
          ok: false,
          error: `Sync is already running`,
          runningTask: {
            taskId: running.task_id,
            status: `${getAppEndpoint(req).baseUrl}/api/${workspaceId}/sources/tasks?taskId=${running.task_id}&syncId=${
              query.syncId
            }`,
            logs: `${getAppEndpoint(req).baseUrl}/api/${workspaceId}/sources/logs?taskId=${running.task_id}&syncId=${
              query.syncId
            }`,
          },
        };
      }
      const service = sync.from;
      if (!service) {
        return {
          ok: false,
          error: `Service ${sync.from} not found`,
        };
      }
      //load state from db
      const stateObj = await db.prisma().source_state.findUnique({
        where: {
          sync_id: query.syncId as string,
        },
      });

      const taskId = randomUUID();
      const res = await rpc(syncURL + "/read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        query: {
          package: (service.config as any).package,
          version: (service.config as any).version,
          taskId,
          syncId: query.syncId,
        },
        body: {
          config: await tryManageOauthCreds({ ...(service.config as ServiceConfig), id: sync.fromId }, req),
          catalog: JSON.parse((sync.data as any).streams),
          ...(stateObj ? { state: stateObj.state } : {}),
        },
      });
      if (!res.ok) {
        return { ok: false, error: res.error ?? "unknown error", taskId };
      } else {
        return {
          ok: true,
          taskId,
          status: `${getAppEndpoint(req).baseUrl}/api/${workspaceId}/sources/tasks?taskId=${taskId}&syncId=${
            query.syncId
          }`,
          logs: `${getAppEndpoint(req).baseUrl}/api/${workspaceId}/sources/logs?taskId=${taskId}&syncId=${
            query.syncId
          }`,
        };
      }
    } catch (e: any) {
      return syncError(log, `Error running sync`, e, false, `sync: ${query.syncId} workspace: ${workspaceId}`);
    }
  })
  .toNextApiHandler();
