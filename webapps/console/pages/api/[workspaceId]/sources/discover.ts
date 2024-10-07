import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { hash as juavaHash, isTruish, requireDefined, rpc } from "juava";
import { getServerLog } from "../../../../lib/server/log";

import { tryManageOauthCreds } from "../../../../lib/server/oauth/services";
import { syncError } from "../../../../lib/server/sync";
import hash from "stable-hash";

const log = getServerLog("sync-discover");

const resultType = z.object({
  ok: z.boolean(),
  pending: z.boolean().optional(),
  catalog: z.object({}).passthrough().optional(),
  error: z.string().optional(),
});

const queryType = z.object({
  workspaceId: z.string(),
  package: z.string(),
  version: z.string(),
  storageKey: z.string(),
});

type catalogKeyType = z.infer<typeof queryType>;

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      serviceId: z.string(),
      refresh: z.string().optional(),
      force: z.string().optional(),
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
      let existingService = await db.prisma().configurationObject.findFirst({
        where: { id: query.serviceId },
      });
      if (!existingService || existingService.workspaceId !== workspaceId) {
        return { ok: false, error: `Service Connector not found for id: ${query.serviceId}` };
      }
      existingService = { ...existingService.config, ...existingService };
      const h = juavaHash("md5", hash(existingService.credentials));
      const storageKey = `${workspaceId}_${existingService.id}_${h}`;

      if (!isTruish(query.force)) {
        const discoverDbRes = await catalogFromDb({
          storageKey,
          package: existingService.package,
          version: existingService.version,
        });
        if (discoverDbRes) {
          if (discoverDbRes.pending) {
            return discoverDbRes;
          } else if (!isTruish(query.refresh)) {
            return discoverDbRes;
          }
        }
      }
      const discoverQueryRes = await rpc(syncURL + "/discover", {
        method: "POST",
        body: {
          config: await tryManageOauthCreds(existingService),
        },
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
        },
        query: {
          package: existingService.package,
          version: existingService.version,
          storageKey: storageKey,
        },
      });
      if (!discoverQueryRes.ok) {
        return { ok: false, error: discoverQueryRes.error ?? "unknown error" };
      } else {
        await db.pgPool().query(
          `INSERT INTO newjitsu.source_catalog (package, version, key, timestamp, status, description)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT ON CONSTRAINT source_catalog_pkey DO UPDATE SET timestamp = $4,
                                                                                 status=$5,
                                                                                 description=$6`,
          [existingService.package, existingService.version, storageKey, new Date(), "RUNNING", "RUNNING"]
        );
        return { ok: false, pending: true };
      }
    } catch (e: any) {
      return syncError(log, `Error running discover`, e, false, `source: ${query.serviceId} workspace: ${workspaceId}`);
    }
  })
  .toNextApiHandler();

async function catalogFromDb(
  query: Omit<catalogKeyType, "workspaceId">
): Promise<{ ok: boolean; catalog?: any; error?: string; pending?: boolean } | undefined> {
  const res = await db.pgPool().query(
    `select catalog, status, description from newjitsu.source_catalog where key = $1
               and package = $2
               and version = $3`,
    [query.storageKey, query.package, query.version]
  );
  if (res.rowCount === 1) {
    const status = res.rows[0].status;
    const catalog = res.rows[0].catalog;
    const description = res.rows[0].description;
    switch (status) {
      case "SUCCESS":
        return { ok: true, catalog: catalog };
      case "RUNNING":
        return { ok: false, pending: true };
      default:
        return { ok: false, error: description };
    }
  } else {
    return undefined;
  }
}
