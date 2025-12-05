import { createInMemoryStore } from "./inmem-store";
import { getLog, parseNumber } from "juava";

const log = getLog("entity-store");

export type EntityStore<T> = {
  getObject: (id: string) => T | undefined;
  getAll: () => Record<string, T>;
  toJSON: () => string;
  enabled: boolean;
  lastModified?: Date;
};

const DisabledStore: EntityStore<any> = {
  enabled: false,
  getObject: () => undefined,
  getAll: () => {
    return {};
  },
  toJSON: () => "disabled",
};

const EmptyStore: EntityStore<any> = {
  enabled: true,
  getObject: () => undefined,
  getAll: () => {
    return {};
  },
  toJSON: () => "",
};

function refreshFunc<T>(storeId: string) {
  return async (
    ifModifiedSince?: Date
  ): Promise<{ lastModified: Date | undefined; store: EntityStore<T> } | "not_modified"> => {
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
      const base = repositoryBase.endsWith("/") ? repositoryBase : `${repositoryBase}/`;
      const url = `${base}${storeId}`;
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: headers,
          keepalive: true,
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
        log
          .atInfo()
          .log(
            `${storeId} updated: ${lastModified?.toISOString()} previous update date is ${ifModifiedSince?.toISOString()}`
          );
        return {
          store: {
            enabled: true,
            getObject: (key: string) => {
              return objs[key];
            },
            getAll() {
              return objs;
            },
            toJSON: () => {
              return JSON.stringify(objs);
            },
            lastModified: lastModified,
          },
          lastModified: lastModified,
        };
      } catch (e) {
        throw new Error(`Failed to load ${storeId} from repository url ${url}: ${e}`);
      }
    } else {
      return { store: DisabledStore, lastModified: new Date() };
    }
  };
}

export function storeFunc<T>(storeId: string, noRefresh?: boolean) {
  return createInMemoryStore<EntityStore<T>>({
    refreshIntervalMillis: noRefresh ? 0 : parseNumber(process.env.REPOSITORY_REFRESH_PERIOD_SEC, 2) * 1000,
    name: `${storeId}-store`,
    localDir: process.env.REPOSITORY_CACHE_DIR,
    serializer: (store: EntityStore<T>) => (store.enabled ? store.toJSON() : ""),
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
          getAll: () => {
            return store || {};
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
}
