import { db } from "../../../../lib/server/db";
import { z } from "zod";
import { createRoute, verifyAccess } from "../../../../lib/api";
import { getServerLog } from "../../../../lib/server/log";
import {
  ProfilesConfig,
  createClient,
  int32Hash,
  userIdHashColumn,
} from "@jitsu/core-functions/src/functions/profiles-functions";
import { mongodb } from "@jitsu/core-functions/src/functions/lib/mongodb";

import { getSingleton, hash } from "juava";
import omit from "lodash/omit";

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
      const config = ProfilesConfig.parse({
        ...(profileBuilder.intermediateStorageCredentials || ({} as any)),
        profileWindowDays: (profileBuilder.connectionOptions || ({} as any)).profileWindow,
        eventsDatabase: `profiles`,
        eventsCollectionName: `profiles-raw-${workspaceId}-${profileBuilder.id}`,
      });

      const mongoSingleton = config.mongoUrl
        ? getSingleton(
            `profiles-mongodb-${profileBuilder.id}-${hash("md5", config.mongoUrl)}`,
            () => {
              log.atInfo().log(`Connecting to MongoDB server.`);
              const cl = createClient({
                mongoUrl: config.mongoUrl,
              } as ProfilesConfig);
              log.atInfo().log(`Connected successfully to MongoDB server.`);
              return cl;
            },
            {
              optional: true,
              ttlSec: 60 * 60 * 24,
              cleanupFunc: client => client.close(),
            }
          )
        : mongodb;

      const mongo = await mongoSingleton.waitInit();

      const events = await mongo
        .db(config.eventsDatabase)
        .collection(config.eventsCollectionName)
        .find({
          [userIdHashColumn]: int32Hash(userId),
          userId: userId,
        })
        .toArray();

      return {
        status: "ok",
        events: events.map(e => omit(e, ["_id", userIdHashColumn])),
      };
    } catch (e: any) {
      return {
        status: "error",
        error: e.message,
      };
    }
  })
  .toNextApiHandler();
