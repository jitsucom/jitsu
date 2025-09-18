import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { getServerLog } from "../../../../lib/server/log";
import { syncError } from "../../../../lib/server/sync";

const log = getServerLog("sync-spec");

const resultType = z.object({
  ok: z.boolean(),
  state: z.record(z.string()).optional(),
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
  .handler(async ({ user, query }) => {
    const { workspaceId, syncId } = query;
    await verifyAccess(user, workspaceId);
    try {
      const sync = db.prisma().configurationObjectLink.findFirst({
        where: {
          workspaceId,
          type: "sync",
          id: syncId,
          deleted: false,
        },
      });
      if (!sync) {
        return { ok: false, error: "sync not found" };
      }

      const res = await db.pgPool().query(
        `select stream, state
                        from newjitsu.source_state
                        where sync_id = $1`,
        [syncId]
      );
      const rows = res.rows;
      if (rows.length === 0) {
        return { ok: true, state: {} };
      }
      const state = Object.fromEntries(rows.map((a, b) => [a.stream, JSON.stringify(a.state, null, 2)]));
      return { ok: true, state };
    } catch (e: any) {
      return syncError(log, `Error loading state`, e, false, `source: ${syncId} workspace: ${workspaceId}`);
    }
  })
  .POST({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      syncId: z.string(),
      stream: z.string(),
    }),
    body: z.object({}).passthrough().optional(),
    result: resultType,
  })
  .handler(async ({ user, query, body }) => {
    const { workspaceId, syncId, stream } = query;
    await verifyAccess(user, workspaceId);
    try {
      const sync = db.prisma().configurationObjectLink.findFirst({
        where: {
          workspaceId,
          type: "sync",
          id: syncId,
          deleted: false,
        },
      });
      if (!sync) {
        return { ok: false, error: "sync not found" };
      }
      const running = await db.prisma().source_task.findFirst({
        where: {
          sync_id: syncId,
          status: "RUNNING",
        },
      });
      if (running) {
        return { ok: false, error: "Sync is running. Please make sure that sync is stopped before editing state." };
      }

      if (!body || Object.keys(body).length === 0) {
        await db.pgPool().query(
          `delete from newjitsu.source_state
                        where sync_id = $1 and stream = $2`,
          [syncId, stream]
        );
      } else {
        await db.pgPool().query(
          `insert into newjitsu.source_state(sync_id, state, timestamp, stream) values($2, $1, now(), $3)
                        on conflict (sync_id, stream) do update
           set state = $1, timestamp = now()`,
          [JSON.stringify(body), syncId, stream]
        );
      }

      const res = await db.pgPool().query(
        `select stream, state
                        from newjitsu.source_state
                        where sync_id = $1`,
        [syncId]
      );
      const rows = res.rows;
      if (rows.length === 0) {
        return { ok: true, state: {} };
      }
      const state = Object.fromEntries(rows.map((a, b) => [a.stream, JSON.stringify(a.state, null, 2)]));
      return { ok: true, state };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  })
  .toNextApiHandler();
