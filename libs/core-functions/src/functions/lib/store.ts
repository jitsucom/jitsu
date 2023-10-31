import { SetOpts, Store } from "@jitsu/protocols/functions";
import type { Redis } from "ioredis";

export const defaultTTL = 60 * 60 * 24 * 31; // 31 days
export const maxAllowedTTL = 60 * 60 * 24 * 93; // 93 days

// TODO: deprecate. we cannot control ttl for hash keys. So this store will consume memory indefinitely
export const createOldStore = (namespace: string, redisClient: Redis): Store => ({
  get: async (key: string) => {
    const res = await redisClient.hget(`store:${namespace}`, key);
    return res ? JSON.parse(res) : undefined;
  },
  set: async (key: string, obj: any) => {
    await redisClient.hset(`store:${namespace}`, key, JSON.stringify(obj));
  },
  del: async (key: string) => {
    await redisClient.hdel(`store:${namespace}`, key);
  },
  ttl: async (key: string) => {
    return await redisClient.ttl(`store:${namespace}`);
  },
});

export const createTtlStore = (namespace: string, redisClient: Redis, defaultTtlSec: number): Store => ({
  get: async (key: string) => {
    const res = await redisClient.get(`store:${namespace}:${key}`);
    return res ? JSON.parse(res) : undefined;
  },
  set: async (key: string, obj: any, opts?: SetOpts) => {
    const ttl = Math.min(opts?.ttl ?? defaultTtlSec, maxAllowedTTL);
    await redisClient.set(`store:${namespace}:${key}`, JSON.stringify(obj), "EX", ttl);
  },
  del: async (key: string) => {
    await redisClient.del(`store:${namespace}:${key}`);
  },
  ttl: async (key: string) => {
    return await redisClient.ttl(`store:${namespace}:${key}`);
  },
});

export const createMultiStore = (ttlStore: Store, oldStore: Store): Store => {
  return {
    get: async (key: string) => {
      const res = await ttlStore.get(key);
      if (res) {
        return res;
      }
      return await oldStore.get(key);
    },
    set: async (key: string, obj: any, opts?: SetOpts) => {
      await ttlStore.set(key, obj, opts);
    },
    del: async (key: string) => {
      await ttlStore.del(key);
      await oldStore.del(key);
    },
    ttl: async (key: string) => {
      return await ttlStore.ttl(key);
    },
  };
};
