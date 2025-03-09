import { Redis } from "ioredis";
import { requireDefined, getLog } from "juava";

const log = getLog("redis");

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

function resolveRedisConnectionOptions(
  redisUrl: string,
  redisSentinelAddress: string | undefined
): Record<string, any> {
  let sentinels: any;

  if (redisSentinelAddress) {
    sentinels = redisSentinelAddress.split(",").map(sentinel => {
      const [host, port] = sentinel.split(":");
      return {
        host,
        port: port ? parseInt(port, 10) : undefined,
      };
    });
  }

  let tls: any;
  if (redisUrl.startsWith("rediss://")) {
    tls = {
      rejectUnauthorized: false,
    };
  }

  return {
    enableAutoPipelining: true,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    sentinels,
    tls,
  };
}

/**
 * Example `REDIS_URL` values for a standalone Redis instance:
 * - Standalone Redis: `redis://username:password@localhost:6379/1`
 * - Standalone Redis with SSL: `rediss://username:password@localhost:6379/2`
 *
 * Example `REDIS_URL` and `REDIS_SENTINEL_ADDRESS` values for Redis Sentinel:
 * - Redis URL: `redis://username:password@/3?name=mymaster`
 * - Redis Sentinel Address: `sentinel1:26379,sentinel2:26379,sentinel3:26379`
 */
export function createRedis(): Redis {
  const redisUrl = requireDefined(process.env.REDIS_URL, "env REDIS_URL is not defined");
  const redisSentinelAddress = process.env.REDIS_SENTINEL_ADDRESS;

  let sanitizedRedisUrl: string = hideSensitiveInfoFromURL(redisUrl);
  if (redisSentinelAddress) {
    sanitizedRedisUrl += ` (${redisSentinelAddress})`;
  }

  log.atDebug().log(`Building redis client for ${sanitizedRedisUrl}`);

  const connectionOptions = resolveRedisConnectionOptions(redisUrl, redisSentinelAddress);
  const redisClient = new Redis(redisUrl, connectionOptions);

  redisClient.on("error", err => {
    log.atWarn().withCause(err).log(`Redis @ ${sanitizedRedisUrl} - failed to connect`);
  });
  redisClient.on("connect", () => {
    log.atInfo().log(`Redis @ ${sanitizedRedisUrl} - successfully connected`);
  });
  return redisClient;
}
