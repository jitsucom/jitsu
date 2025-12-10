import { SetOpts, TTLStore } from "@jitsu/protocols/functions";
import parse from "parse-duration";

export const defaultTTL = 60 * 60 * 24 * 31; // 31 days
export const maxAllowedTTL = 2147483647; // max allowed value for ttl in redis (68years)

export function getTtlSec(opts?: SetOpts): number {
  let seconds = defaultTTL;
  if (typeof opts === "number") {
    seconds = Math.ceil(opts);
  } else if (typeof opts === "string") {
    if (opts.toLowerCase() === "inf") {
      seconds = -1;
    } else {
      try {
        seconds = Math.ceil(parse(opts, "s") || defaultTTL);
      } catch (e) {}
    }
  } else if (typeof opts === "object") {
    return getTtlSec(opts.ttl);
  }
  return Math.min(seconds, maxAllowedTTL);
}

export const createMultiStore = (newStore: TTLStore, oldStore: TTLStore): TTLStore => {
  return {
    get: async (key: string) => {
      const res = await newStore.get(key);
      if (res) {
        return res;
      }
      return await oldStore.get(key);
    },
    set: async (key: string, obj: any, opts?: SetOpts) => {
      await newStore.set(key, obj, opts);
    },
    del: async (key: string) => {
      await newStore.del(key);
      await oldStore.del(key);
    },
    ttl: async (key: string) => {
      const res = await newStore.ttl(key);
      if (res >= -1) {
        return res;
      }
      return await oldStore.ttl(key);
    },
    getWithTTL: async (key: string) => {
      const res = await newStore.getWithTTL(key);
      if (res) {
        return res;
      }
      return await oldStore.getWithTTL(key);
    },
  };
};

export const createDummyStore = (): TTLStore => ({
  get: async (key: string) => {
    return undefined;
  },
  set: async (key: string, obj: any, opts) => {},
  del: async (key: string) => {},
  ttl: async (key: string) => {
    return -2;
  },
  getWithTTL: async (key: string) => {
    return undefined;
  },
});

export const createMemoryStore = (store: any): TTLStore => ({
  get: async (key: string) => {
    const val = store[key];
    if (val?.expireAt) {
      if (val.expireAt < new Date().getTime()) {
        delete store[key];
        return undefined;
      }
      return val.obj;
    }
    return val;
  },
  set: async (key: string, obj: any, opts) => {
    store[key] = {
      obj,
      expireAt: new Date().getTime() + getTtlSec(opts) * 1000,
    };
  },
  del: async (key: string) => {
    delete store[key];
  },
  ttl: async (key: string) => {
    const val = store[key];
    if (!val) {
      return -2;
    }
    const diff = (val.expireAt - new Date().getTime()) / 1000;
    if (diff < 0) {
      delete store[key];
      return -2;
    }
    return Math.floor(diff);
  },
  getWithTTL: async (key: string) => {
    const val = store[key];
    if (!val) {
      return undefined;
    }
    const diff = (val.expireAt - new Date().getTime()) / 1000;
    if (diff < 0) {
      delete store[key];
      return undefined;
    }
    return {
      value: val.obj,
      ttl: Math.floor(diff),
    };
  },
});

export const memoryStoreDump = (store: any): any => {
  const dt = new Date().getTime();
  return Object.entries(store as Record<string, any>)
    .map(([k, v]) => {
      if (v?.expireAt) {
        if (v.expireAt < dt) {
          return null;
        }
        return [k, v.obj];
      }
      return [k, v];
    })
    .filter(v => v !== null)
    .reduce((prev, cur) => {
      if (cur) {
        prev[cur[0]] = cur[1];
      }
      return prev;
    }, {});
};
