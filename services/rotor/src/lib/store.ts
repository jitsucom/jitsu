import { SetOpts, TTLStore } from "@jitsu/protocols/functions";
import type { Redis } from "ioredis";
import { RetryError } from "@jitsu/functions-lib";
import { getLog } from "juava";
import { getTtlSec, StoreMetrics } from "@jitsu/core-functions-lib";

const log = getLog("store");

function success(namespace: string, operation: "get" | "set" | "del" | "ttl", metrics?: StoreMetrics) {
  if (metrics) {
    metrics.storeStatus(namespace, operation, "success");
  }
}

export function storeErr(
  namespace: string,
  operation: "get" | "set" | "del" | "ttl",
  err: any,
  text: string,
  metrics?: StoreMetrics
) {
  log.atError().log(`${text}: ${err.message}`);
  if (metrics) {
    metrics.storeStatus(namespace, operation, "error");
  }
  if ((err.message ?? "").includes("timed out")) {
    return new RetryError(text + ": Timed out.");
  }
  return new RetryError(text + ": " + err.message);
}

export const createRedisStore = (namespace: string, redisClient: Redis, metrics?: StoreMetrics): TTLStore => ({
  get: async (key: string) => {
    try {
      const res = await redisClient.get(`store:${namespace}:${key}`);
      success(namespace, "get", metrics);
      return res ? JSON.parse(res) : undefined;
    } catch (err: any) {
      throw storeErr(namespace, "get", err, `Error getting key ${key} from redis store ${namespace}`, metrics);
    }
  },
  getWithTTL: async (key: string) => {
    try {
      const res = await redisClient.get(`store:${namespace}:${key}`);
      if (!res) {
        return undefined;
      }
      const ttl = await redisClient.ttl(`store:${namespace}:${key}`);
      success(namespace, "get", metrics);
      return { value: JSON.parse(res), ttl };
    } catch (err: any) {
      throw storeErr(namespace, "get", err, `Error getting key ${key} from redis store ${namespace}`, metrics);
    }
  },
  set: async (key: string, obj: any, opts?: SetOpts) => {
    try {
      const ttl = getTtlSec(opts);
      if (ttl >= 0) {
        await redisClient.set(`store:${namespace}:${key}`, JSON.stringify(obj), "EX", ttl);
      } else {
        await redisClient.set(`store:${namespace}:${key}`, JSON.stringify(obj));
      }
      success(namespace, "set", metrics);
    } catch (err: any) {
      throw storeErr(namespace, "set", err, `Error setting key ${key} from redis store ${namespace}`, metrics);
    }
  },
  del: async (key: string) => {
    try {
      await redisClient.del(`store:${namespace}:${key}`);
      success(namespace, "del", metrics);
    } catch (err: any) {
      throw storeErr(namespace, "del", err, `Error deleting key ${key} from redis store ${namespace}`, metrics);
    }
  },
  ttl: async (key: string) => {
    try {
      const res = await redisClient.ttl(`store:${namespace}:${key}`);
      success(namespace, "ttl", metrics);
      return res;
    } catch (err: any) {
      throw storeErr(namespace, "ttl", err, `Error getting key ${key} from redis store ${namespace}`, metrics);
    }
  },
});
