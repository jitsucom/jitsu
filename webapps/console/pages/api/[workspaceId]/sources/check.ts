import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { ServiceConfig } from "../../../../lib/schema";
import { randomId, requireDefined, rpc } from "juava";

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
  .handler(async ({ user, query, body }) => {
    const { workspaceId } = query;
    await verifyAccess(user, workspaceId);

    const syncURL = requireDefined(
      process.env.SYNCCTL_URL,
      `env SYNCCTL_URL is not set. Sync Controller is required to run sources`
    );

    try {
      const checkRes = await rpc(syncURL + "/check", {
        method: "POST",
        body: {
          config: JSON.parse(body.credentials),
        },
        headers: {
          "Content-Type": "application/json",
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
      const errorId = randomId();
      console.error(
        `Error running connection check for source ${query.storageKey} in workspace ${workspaceId}. Error ID: ${errorId}. Error: ${e}`
      );
      return {
        ok: false,
        error: `couldn't run connection check due to internal server error. Please contact support. Error ID: ${errorId}`,
      };
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
      const errorId = randomId();
      console.error(
        `Error running connection check for source ${query.storageKey} in workspace ${workspaceId}. Error ID: ${errorId}. Error: ${e}`
      );
      return {
        ok: false,
        error: `couldn't run connection check due to internal server error. Please contact support. Error ID: ${errorId}`,
      };
    }
  })
  .toNextApiHandler();
