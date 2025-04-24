import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { getServerLog } from "../../../../lib/server/log";

const log = getServerLog("profile-builder-state");

const resultType = z.object({
  status: z.enum(["ready", "building", "unknown", "error"]),
  error: z.string().optional(),
  updatedAt: z.date().optional(),
  fullRebuildInfo: z.any().optional(),
  queuesInfo: z.any().optional(),
  metrics: z.any().optional(),
});

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      profileBuilderId: z.string(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query }) => {
    const { workspaceId, profileBuilderId } = query;
    await verifyAccess(user, workspaceId);

    const pb = await db.prisma().profileBuilder.findFirst({
      where: {
        id: profileBuilderId,
        workspaceId: workspaceId,
      },
    });
    if (!pb) {
      return {
        status: "error",
        error: "Profile Builder not found",
      };
    }

    try {
      const res = await db.pgPool().query(
        `select "updatedAt",
                "fullRebuildInfo",
                "queuesInfo",
                "metrics"
         from newjitsu."ProfileBuilderState2"
         where "profileBuilderId" = $1`,
        [profileBuilderId]
      );
      if (res.rowCount === 1) {
        const row = res.rows[0];
        let queueSize = 0;
        if (row.queuesInfo) {
          queueSize = Object.values(row.queuesInfo.queues).reduce((total: number, item: any) => total + item.size, 0);
        }
        const status = queueSize ? "building" : "ready";
        return {
          status,
          updatedAt: row.updatedAt,
          fullRebuildInfo: row.fullRebuildInfo,
          queuesInfo: row.queuesInfo,
          metrics: row.metrics,
        };
      } else {
        return {
          status: "unknown",
        };
      }
    } catch (e: any) {
      return {
        status: "error",
        error: e.message,
      };
    }
  })
  .POST({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      profileBuilderId: z.string(),
    }),
    result: z.object({
      status: z.enum(["ok", "error"]),
      error: z.string().optional(),
    }),
  })
  .handler(async ({ user, query }) => {
    const { workspaceId, profileBuilderId } = query;
    await verifyAccess(user, workspaceId);

    const pb = await db.prisma().profileBuilder.findFirst({
      where: {
        id: profileBuilderId,
        workspaceId: workspaceId,
      },
    });
    if (!pb) {
      return {
        status: "error",
        error: "Profile Builder not found",
      };
    }

    try {
      await db
        .pgPool()
        .query(`update newjitsu."ProfileBuilderState2" set "fullRebuildInfo"=$2 where "profileBuilderId" = $1`, [
          profileBuilderId,
          { version: pb.version, timestamp: new Date() },
        ]);
      return {
        status: "ok",
      };
    } catch (e: any) {
      return {
        status: "error",
        error: e.message,
      };
    }
  })
  .toNextApiHandler();
