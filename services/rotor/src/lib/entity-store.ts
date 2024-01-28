import { createInMemoryStore } from "./inmem-store";
import { getLog } from "juava";
import { httpAgent, httpsAgent } from "@jitsu/core-functions";
import fetch from "node-fetch-commonjs";

const log = getLog("entity-store");

export type EntityStore = {
  getObject: (id: string) => any;
  toJSON: () => string;
  enabled: boolean;
};

const DisabledStore: EntityStore = {
  enabled: false,
  getObject: () => undefined,
  toJSON: () => "disabled",
};

const EmptyStore: EntityStore = {
  enabled: true,
  getObject: () => undefined,
  toJSON: () => "",
};

const refreshFunc =
  (storeId: string) =>
  async (ifModifiedSince?: Date): Promise<{ lastModified: Date | undefined; store: EntityStore } | "not_modified"> => {
    const repositoryBase = process.env.REPOSITORY_BASE_URL;
    if (repositoryBase) {
      const objs: Record<string, any> = {};
      const headers: Record<string, string> = {};
      let lastModified: Date | undefined = undefined;
      if (process.env.REPOSITORY_AUTH_TOKEN) {
        headers["Authorization"] = `Bearer ${process.env.REPOSITORY_AUTH_TOKEN}`;
      }
      if (ifModifiedSince) {
        headers["If-Modified-Since"] = ifModifiedSince.toUTCString();
      }
      try {
        const base = repositoryBase.endsWith("/") ? repositoryBase : `${repositoryBase}/`;
        const res = await fetch(`${base}${storeId}`, {
          method: "GET",
          headers: headers,
          agent: await (repositoryBase.startsWith("https://") ? httpsAgent : httpAgent).waitInit(),
        });
        if (res.status === 304) {
          log.atDebug().log(`${storeId} nod modified: ${ifModifiedSince}`);
          await res.text();
          return "not_modified";
        }
        if (!res.ok) {
          throw new Error(`Failed to load ${storeId} from repository: ${res.status} response: ${await res.text()}`);
        }
        const json: any = await res.json();
        for (const fn of json) {
          objs[fn.id] = fn;
        }
        const lmString = res.headers.get("Last-Modified");
        if (lmString) {
          lastModified = new Date(lmString);
        }
        log.atInfo().log(`${storeId} updated: ${lastModified} previous update date: ${ifModifiedSince}`);
        return {
          store: {
            enabled: true,
            getObject: (key: string) => {
              return objs[key];
            },
            toJSON: () => {
              return JSON.stringify(objs);
            },
          },
          lastModified: lastModified,
        };
      } catch (e) {
        throw new Error(`Failed to load ${storeId} from repository: ${e}`);
      }
    } else {
      return { store: DisabledStore, lastModified: new Date() };
    }
  };

const storeFunc = (storeId: string) =>
  createInMemoryStore({
    refreshIntervalMillis: process.env.REPOSITORY_REFRESH_PERIOD_SEC
      ? parseInt(process.env.REPOSITORY_REFRESH_PERIOD_SEC) * 1000
      : 2000,
    name: `${storeId}-store`,
    localDir: process.env.REPOSITORY_CACHE_DIR,
    serializer: (store: EntityStore) => (store.enabled ? store.toJSON() : ""),
    deserializer: (serialized: string) => {
      if (serialized) {
        if (serialized === "disabled") {
          return DisabledStore;
        }
        const store = JSON.parse(serialized);
        return {
          enabled: true,
          getObject: (key: string): any => {
            return store?.[key];
          },
          toJSON: () => {
            return store ? JSON.stringify(store) : "";
          },
        };
      } else {
        return EmptyStore;
      }
    },
    refresh: refreshFunc(storeId),
  });

export const functionsStore = storeFunc("functions");
export const connectionsStore = storeFunc("rotor-connections");
