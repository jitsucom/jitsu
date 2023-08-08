import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { ServiceConfig } from "../../../../lib/schema";
import { requireDefined, rpc } from "juava";
import { tryManageOauthCreds } from "../../../../lib/server/oauth/services";
import { syncError } from "../../../../lib/shared/errors";
import { getServerLog } from "../../../../lib/server/log";

const log = getServerLog("sync-check");

const resultType = z.object({
  ok: z.boolean(),
  pending: z.boolean().optional(),
  error: z.string().optional(),
});

export default createRoute()
  .POST({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      storageKey: z.string(),
    }),
    body: ServiceConfig,
    result: resultType,
  })
  .handler(async ({ user, query, body, req }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    const syncURL = requireDefined(
      process.env.SYNCCTL_URL,
      `env SYNCCTL_URL is not set. Sync Controller is required to run sources`
    );
    if (!query.storageKey.startsWith(workspaceId)) {
      return { ok: false, error: "storageKey doesn't belong to the current workspace" };
    }
    const syncAuthKey = process.env.SYNCCTL_AUTH_KEY ?? "";
    const authHeaders: any = {};
    if (syncAuthKey) {
      authHeaders["Authorization"] = `Bearer ${syncAuthKey}`;
    }
    const config = await tryManageOauthCreds(body as ServiceConfig);

    try {
      const checkRes = await rpc(syncURL + "/check", {
        method: "POST",
        body: {
          config: config,
        },
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        query: {
          package: body.package,
          version: body.version,
          storageKey: query.storageKey,
        },
      });
      if (!checkRes.ok) {
        return { ok: false, error: checkRes.error ?? "unknown error" };
      } else {
        return { ok: false, pending: true };
      }
    } catch (e: any) {
      return syncError(
        log,
        `Error running connection check`,
        e,
        false,
        `source: ${query.storageKey} workspace: ${workspaceId}`
      );
    }
  })
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      storageKey: z.string(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query, body }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);
    if (!query.storageKey.startsWith(workspaceId)) {
      return { ok: false, error: "storageKey doesn't belong to the current workspace" };
    }
    try {
      const res = await db
        .pgPool()
        .query(`select status, description from source_check where key = $1`, [query.storageKey]);
      if (res.rowCount === 1) {
        const status = res.rows[0].status;
        const description = res.rows[0].description;
        if (status === "SUCCESS") {
          return {
            ok: true,
          };
        } else {
          return {
            ok: false,
            error: description,
          };
        }
      } else {
        return {
          ok: false,
          pending: true,
        };
      }
    } catch (e: any) {
      return syncError(
        log,
        `Error running connection check`,
        e,
        false,
        `source: ${query.storageKey} workspace: ${workspaceId}`
      );
    }
  })
  .toNextApiHandler();
