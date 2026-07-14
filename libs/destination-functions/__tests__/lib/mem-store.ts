import { AnonymousEventsStore, SetOpts, Store, TTLStore } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

export function createStore(): TTLStore {
  return {
    del(key: string): Promise<void> {
      throw new Error("Method not implemented.");
    },
    get(key: string): Promise<any> {
      throw new Error("Method not implemented.");
    },
    getWithTTL(key: string): Promise<{ value: any; ttl: number } | undefined> {
      throw new Error("Method not implemented.");
    },
    getOrSet(key: string, value: any, opts?: SetOpts): Promise<any> {
      throw new Error("Method not implemented.");
    },
    set(key: string, value: any, opts?: SetOpts): Promise<void> {
      throw new Error("Method not implemented.");
    },
    ttl(key: string): Promise<number> {
      throw new Error("Method not implemented.");
    },
  };
}

// A working in-memory TTLStore (TTL is ignored) for functions that actually read/write the store —
// e.g. the contact destinations, which cache field/property definitions and userId→email mappings.
export function createMemoryStore(): TTLStore {
  const data = new Map<string, any>();
  return {
    async get(key: string) {
      return data.get(key);
    },
    async set(key: string, value: any) {
      data.set(key, value);
    },
    async del(key: string) {
      data.delete(key);
    },
    async ttl() {
      return -1;
    },
    async getWithTTL(key: string) {
      return data.has(key) ? { value: data.get(key), ttl: -1 } : undefined;
    },
    async getOrSet(key: string, value: any) {
      if (!data.has(key)) {
        data.set(key, value);
      }
      return data.get(key);
    },
  };
}

export type EventsByAnonId = Record<string, AnalyticsServerEvent[]>;

export function createAnonymousEventsStore(eventsStore: Record<string, EventsByAnonId>): AnonymousEventsStore {
  return {
    async addEvent(collectionName: string, anonymousId: string, event: AnalyticsServerEvent, ttlDays: number) {
      let collection = eventsStore[collectionName];
      if (!collection) {
        collection = eventsStore[collectionName] = {};
      }
      let byAnonId = collection[anonymousId];
      if (!byAnonId) {
        byAnonId = collection[anonymousId] = [];
      }
      byAnonId.push(event);
    },

    async evictEvents(collectionName: string, anonymousId: string) {
      const collection = eventsStore[collectionName];
      if (collection) {
        const res = collection[anonymousId] || [];
        delete collection[anonymousId];
        return res;
      }
      return [];
    },
  };
}
