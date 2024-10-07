import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { isTruish, requireDefined, rpc } from "juava";
import { getServerLog } from "../../../../lib/server/log";
import { syncError } from "../../../../lib/server/sync";

const log = getServerLog("sync-spec");

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
      force: z.string().optional(),
    }),
    result: resultType,
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
    try {
      const res = await db.pgPool().query(
        `select specs, error
                        from newjitsu.source_spec
                        where package = $1
                          and version = $2`,
        [query.package, query.version]
      );
      let error;
      if (res.rowCount === 1) {
        const specs = res.rows[0].specs;
        if (specs) {
          return {
            ok: true,
            specs,
          };
        } else {
          error = res.rows[0].error ?? "unknown error";
          if (error === "pending") {
            return { ok: false, pending: true };
          }
        }
      }
      if (!res.rowCount || isTruish(query.force)) {
        const checkRes = await rpc(syncURL + "/spec", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders,
          },
          query: {
            package: query.package,
            version: query.version,
          },
        });
        if (!checkRes.ok) {
          return { ok: false, error: checkRes.error ?? "unknown error" };
        } else {
          await db.pgPool().query(
            `insert into newjitsu.source_spec as s (package, version, specs, timestamp, error)
                     values ($1, $2, null, $3, $4)
                     ON CONFLICT ON CONSTRAINT source_spec_pkey DO UPDATE SET specs = null,
                                                                              timestamp = $3,
                                                                              error = $4`,
            [query.package, query.version, new Date(), "pending"]
          );
          return { ok: false, pending: true };
        }
      } else {
        if (error) {
          return { ok: false, error };
        } else {
          return { ok: false, pending: true };
        }
      }
    } catch (e: any) {
      return syncError(
        log,
        `Error loading specs`,
        e,
        false,
        `source: ${query.package}:${query.version} workspace: ${workspaceId}`
      );
    }
  })
  .toNextApiHandler();
