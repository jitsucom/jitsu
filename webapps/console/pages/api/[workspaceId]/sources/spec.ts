import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { requireDefined, rpc } from "juava";
import { JSONSchemaFaker } from "json-schema-faker";
import { JsonObject } from "type-fest";
import { getServerLog } from "../../../../lib/server/log";
import { syncError } from "../../../../lib/shared/errors";

const log = getServerLog("sync-spec");

JSONSchemaFaker.option("alwaysFakeOptionals", true);
JSONSchemaFaker.option("useDefaultValue", true);
JSONSchemaFaker.option("useExamplesValue", true);
JSONSchemaFaker.option("sortProperties", true);
JSONSchemaFaker.option("fillProperties", false);
JSONSchemaFaker.option("maxItems", 2);
JSONSchemaFaker.option("minLength", 2);
JSONSchemaFaker.option("replaceEmptyByRandomValue", true);
JSONSchemaFaker.option("ignoreProperties", ["replication_method", "tunnel_method"]);

const resultType = z.object({
  ok: z.boolean(),
  pending: z.boolean().optional(),
  error: z.string().optional(),
  specs: z.object({}).passthrough().optional(),
  fakeJson: z.object({}).passthrough().optional(),
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
        if (specs) {
          const fakeJson = await JSONSchemaFaker.resolve(specs.connectionSpecification);
          return {
            ok: true,
            specs,
            fakeJson: fakeJson as JsonObject,
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
