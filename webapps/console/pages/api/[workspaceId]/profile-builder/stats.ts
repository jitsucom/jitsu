import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { getServerLog } from "../../../../lib/server/log";

const log = getServerLog("profile-builder-stats");

const resultType = z.object({
  status: z.enum(["ready", "building", "unknown", "error"]),
  error: z.string().optional(),
  startedAt: z.date().optional(),
  totalUsers: z.number().optional(),
  processedUsers: z.number().optional(),
  errorUsers: z.number().optional(),
  speed: z.number().optional(),
});

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      profileBuilderId: z.string(),
      version: z.string(),
    }),
    result: resultType,
  })
  .handler(async ({ user, query }) => {
    const { workspaceId, profileBuilderId, version } = query;
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
        `select "profileBuilderId",
                "profileBuilderVersion",
                min("startedAt") "startedAt",
                max("lastTimestamp") "lastTimestamp",
                sum("totalUsers") "totalUsers",
                sum("processedUsers") "processedUsers",
                sum("errorUsers") "errorUsers",
                avg(speed) speed
         from newjitsu."ProfileBuilderState" where "profileBuilderId" = $1 and "profileBuilderVersion" = $2
         group by "profileBuilderId", "profileBuilderVersion"`,
        [profileBuilderId, version]
      );
      let error;
      if (res.rowCount === 1) {
        const status = res.rows[0].lastTimestamp ? "ready" : "building";
        return {
          status,
          startedAt: res.rows[0].startedAt,
          totalUsers: parseInt(res.rows[0].totalUsers),
          processedUsers: parseInt(res.rows[0].processedUsers),
          errorUsers: parseInt(res.rows[0].errorUsers),
          speed: parseFloat(res.rows[0].speed),
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
  .toNextApiHandler();
