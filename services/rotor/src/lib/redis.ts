import { getSingleton } from "juava";
import { Redis } from "ioredis";
import { requireDefined, getLog } from "juava";

export const log = getLog("redis");

export const redis = getSingleton<Redis>("redis", createRedis);

function hideSensitiveInfoFromURL(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (e) {
    //if URL is not parseable, we just return it as is. We can't fail and
    //rethrow error
    return url;
  }
  if (parsed.password) {
    parsed.password = "****";
  }
  return parsed.toString();
}

function createRedis(): Redis {
  const redisUrl = requireDefined(process.env.REDIS_URL, "env REDIS_URL is not defined");
  log.atDebug().log(`Building redis client for ${hideSensitiveInfoFromURL(redisUrl)}`);
  let tls: any = undefined;
  if (redisUrl.startsWith("rediss://")) {
    tls = {
      rejectUnauthorized: false,
    };
  }
  const redisClient = new Redis(requireDefined(process.env.REDIS_URL, "env REDIS_URL is not defined"), {
    maxRetriesPerRequest: 3,
    tls: tls,
    lazyConnect: false,
    enableAutoPipelining: true,
  });
  redisClient.on("error", err => {
    log
      .atWarn()
      .withCause(err)
      .log(`Redis @ ${hideSensitiveInfoFromURL(redisUrl)} - failed to connect`);
  });
  redisClient.on("connect", () => {
    log.atInfo().log(`Redis @ ${hideSensitiveInfoFromURL(redisUrl)} - successfully connected`);
  });
  return redisClient;
}
