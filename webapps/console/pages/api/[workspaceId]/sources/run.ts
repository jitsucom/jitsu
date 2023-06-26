import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { randomId, requireDefined, rpc } from "juava";
import { randomUUID } from "crypto";

const resultType = z.object({
  ok: z.boolean(),
  taskID: z.string().optional(),
  error: z.string().optional(),
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
  .handler(async ({ user, query, body }) => {
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
      const sync = await db.prisma().configurationObjectLink.findUnique({
        where: {
          id: query.syncId as string,
        },
        include: {
          from: true,
        },
      });
      if (!sync) {
        return {
          ok: false,
          error: `syncId ${query.syncId} not found`,
        };
      }
      console.log("sync", sync);
      const service = sync.from;
      if (!service) {
        return {
          ok: false,
          error: `service ${sync.from} not found`,
        };
      }
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
          config: JSON.parse((service.config as any).credentials),
          catalog: JSON.parse((sync.data as any).streams),
        },
      });
      if (!res.ok) {
        return { ok: false, error: res.error ?? "unknown error", taskId };
      } else {
        return { ok: true, taskId };
      }
    } catch (e: any) {
      const errorId = randomId();
      console.error(
        `Error running sync ${query.syncId} in workspace ${workspaceId}. Error ID: ${errorId}. Error: ${e}`
      );
      return {
        ok: false,
        error: `couldn't run sync due to internal server error. Please contact support. Error ID: ${errorId}`,
      };
    }
  })
  .toNextApiHandler();
