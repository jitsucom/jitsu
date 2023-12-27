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
    set(key: string, value: any, opts?: SetOpts): Promise<void> {
      throw new Error("Method not implemented.");
    },
    ttl(key: string): Promise<number> {
      throw new Error("Method not implemented.");
    },
  };
}

type EventsByAnonId = Record<string, AnalyticsServerEvent[]>;
const eventsStore: Record<string, EventsByAnonId> = {};

export function createAnonymousEventsStore(): AnonymousEventsStore {
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
