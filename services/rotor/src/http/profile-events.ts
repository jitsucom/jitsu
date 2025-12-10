import { getLog, getSingleton, hash, int32Hash } from "juava";
import omit from "lodash/omit";
import { db } from "../lib/db";
import { createClient, profileIdColumn, profileIdHashColumn, ProfilesConfig } from "../lib/profiles-functions";
import { mongodb } from "../lib/mongodb";

const log = getLog("profile-events");

export const ProfileEventsHandler = async (req, res) => {
  const body = req.body;
  const workspaceId = body.workspaceId as string;
  const profileBuilderId = body.profileBuilderId as string;
  const userId = body.userId as string;
  const profileBuilder = await db.pgHelper().getProfileBuilder(workspaceId, profileBuilderId);
  if (!profileBuilder) {
    res.json({
      status: "error",
      error: "Profile Builder not found",
    });
    return;
  }
  try {
    const config = ProfilesConfig.parse({
      profileBuilderId: profileBuilder.id,
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
              mongoUrl: config.mongoUrl!,
            });
            log.atInfo().log(`Connected successfully to MongoDB server.`);
            return cl;
          },
          {
            optional: true,
            ttlSec: 60 * 60,
            cleanupFunc: client => client.close(),
          }
        )
      : mongodb;

    const mongo = await mongoSingleton.waitInit();

    const events = await mongo
      .db(config.eventsDatabase)
      .collection(config.eventsCollectionName)
      .find({
        [profileIdHashColumn]: int32Hash(userId),
        [profileIdColumn]: userId,
      })
      .toArray();

    res.json({
      status: "ok",
      events: events.map(e => omit(e, ["_id", profileIdHashColumn])),
    });
  } catch (e: any) {
    log.atError().withCause(e).log(`Error while fetching events from MongoDB: ${e}`);
    res.json({
      status: "error",
      error: e.message,
    });
  }
};
