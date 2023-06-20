import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { randomId, requireDefined, rpc } from "juava";

const resultType = z.object({
  ok: z.boolean(),
  pending: z.boolean().optional(),
  error: z.string().optional(),
  specs: z.object({}).passthrough().optional(),
  startedAt: z.number().optional(),
});

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      package: z.string(),
      version: z.string(),
      after: z.string().optional(),
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
    try {
      let res;
      if (query.after) {
        res = await db
          .pgPool()
          .query(`select specs, error from source_spec where package = $1 and version = $2 and timestamp >= $3`, [
            query.package,
            query.version,
            new Date(parseInt(query.after)),
          ]);
      } else {
        res = await db
          .pgPool()
          .query(`select specs, error from source_spec where package = $1 and version = $2`, [
            query.package,
            query.version,
          ]);
      }
      let error;
      if (res.rowCount === 1) {
        const specs = res.rows[0].specs;
        if (!error && specs) {
          return {
            ok: true,
            specs,
          };
        } else {
          error = res.rows[0].error ?? "unknown error";
        }
      }
      if (!query.after) {
        const checkRes = await rpc(syncURL + "/spec", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          query: {
            package: query.package,
            version: query.version,
          },
        });
        if (!checkRes.ok) {
          return { ok: false, error: checkRes.error ?? "unknown error" };
        } else {
          return { ok: false, pending: true, startedAt: checkRes.startedAt };
        }
      } else {
        if (error) {
          return { ok: false, error };
        } else {
          return { ok: false, pending: true, startedAt: parseInt(query.after) };
        }
      }
    } catch (e: any) {
      const errorId = randomId();
      console.error(
        `Error loading specs for source ${query.package}:${query.version} in workspace ${workspaceId}. Error ID: ${errorId}. Error: ${e}`
      );
      return {
        ok: false,
        error: `couldn't load specs due to internal server error. Please contact support. Error ID: ${errorId}`,
      };
    }
  })
  .toNextApiHandler();
