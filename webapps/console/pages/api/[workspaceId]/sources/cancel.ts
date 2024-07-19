import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { requireDefined, rpc } from "juava";
import { getServerLog } from "../../../../lib/server/log";
import { syncError } from "../../../../lib/server/sync";
import { db } from "../../../../lib/server/db";

const log = getServerLog("sync-spec");

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
      taskId: z.string(),
      package: z.string(),
    }),
    result: z.any(),
  })
  .handler(async ({ user, query }) => {
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

    const existingLink = await db
      .prisma()
      .configurationObjectLink.findFirst({ where: { workspaceId: workspaceId, id: query.syncId, deleted: false } });
    if (!existingLink) {
      return { ok: false, error: `sync with id ${query.syncId} not found in the workspace` };
    }

    try {
      const res = await rpc(syncURL + "/cancel", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        query,
      });
      if (!res.ok) {
        return { ok: false, error: res.error ?? "unknown error" };
      } else {
        return { ok: false, pending: true, startedAt: res.startedAt };
      }
    } catch (e: any) {
      return syncError(
        log,
        `Error cancelling sync job`,
        e,
        false,
        `syncId: ${query.syncId} taskId: ${query.taskId} package: ${query.package}`
      );
    }
  })
  .toNextApiHandler();
