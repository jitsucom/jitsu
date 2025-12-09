import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { getServerLog } from "../../../../lib/server/log";
import { requireDefined, rpc } from "juava";
import { getServerEnv } from "../../../../lib/server/serverEnv";

const log = getServerLog("profile-builder-events");

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      workspaceId: z.string(),
      profileBuilderId: z.string(),
      userId: z.string(),
    }),
  })
  .handler(async ({ user, query }) => {
    const { workspaceId, profileBuilderId, userId } = query;
    await verifyAccess(user, workspaceId);
    const serverEnv = getServerEnv();
    const rotorURL = requireDefined(
      serverEnv.ROTOR_URL,
      `env ROTOR_URL is not set. Rotor is required to run functions`
    );
    const rotorAuthKey = serverEnv.ROTOR_AUTH_KEY;

    const profileBuilder = await db.prisma().profileBuilder.findFirst({
      where: {
        id: profileBuilderId,
        workspaceId: workspaceId,
      },
    });
    if (!profileBuilder) {
      return {
        status: "error",
        error: "Profile Builder not found",
      };
    }
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (rotorAuthKey) {
        headers["Authorization"] = `Bearer ${rotorAuthKey}`;
      }
      const res = await rpc(rotorURL + "/profileevents", {
        method: "POST",
        body: {
          profileBuilderId,
          workspaceId,
          userId,
        },
        headers,
      });
      return res;
    } catch (e: any) {
      log.atError().withCause(e).log(`Error while fetching events from MongoDB: ${e}`);
      return {
        status: "error",
        error: e.message,
      };
    }
  })
  .toNextApiHandler();
