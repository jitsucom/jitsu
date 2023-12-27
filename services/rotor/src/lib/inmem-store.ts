import { getErrorMessage, getLog } from "juava";
import fs from "fs";
import path from "path";

export type StoreDefinition<T = any> = {
  refreshIntervalMillis: number;
  name: string;
  refresh: () => Promise<T>;
  serializer?: (arg: T) => string;
  deserializer?: (arg: string) => T;
  localDir?: string;
};

const log = getLog("inmem-store");

type Status = "ok" | "initializing" | "outdated" | "failed" | "stopped";
export type InMemoryStore<T> = {
  status(): Status;
  get(): Promise<T>;
  getCurrent(): T | undefined;
  lastRefresh(): Date | undefined;
  stop(): void;
};

function saveLocalCache(definition: StoreDefinition, instance: any) {
  if (definition.localDir) {
    fs.mkdirSync(definition.localDir, { recursive: true });
    const serialized = definition.serializer ? definition.serializer(instance) : JSON.stringify(instance);
    const cacheFile = path.join(definition.localDir, `${definition.name}-latest.json`);
    fs.writeFile(cacheFile, serialized, err => {
      if (err) {
        log.atWarn().withCause(err).log(`Failed to save local cache for ${definition.name}`);
      }
    });
  }
}

function loadFromCache(definition: StoreDefinition): { updateDate: Date; instance: any } | undefined {
  if (definition.localDir) {
    const cacheFile = path.join(definition.localDir, `${definition.name}-latest.json`);
    try {
      const cached = fs.readFileSync(cacheFile).toString();
      return {
        updateDate: new Date(fs.statSync(cacheFile).mtime),
        instance: definition.deserializer ? definition.deserializer(cached) : JSON.parse(cached),
      };
    } catch (e) {
      log.atWarn().withCause(e).log(`Failed to load local cache for ${definition.name}`);
    }
  } else {
    log.atWarn().log(`Local cache is not configured for ${definition.name}`);
  }
}

export const createInMemoryStore = <T>(definition: StoreDefinition<T>): InMemoryStore<T> => {
  let status: Status = "initializing";
  let instance: T | undefined = undefined;
  let lastRefresh: Date | undefined = undefined;
  let stopping: boolean = false;
  let intervalToClear: NodeJS.Timeout | undefined = undefined;

  function scheduleStoreRefresh() {
    intervalToClear = setInterval(async () => {
      if (stopping) {
        return;
      }
      try {
        instance = await definition.refresh();
        saveLocalCache(definition, instance);
        status = "ok";
        lastRefresh = new Date();
      } catch (e) {
        log.atWarn().withCause(e).log(`Failed to refresh store ${definition.name}. Using an old value`);
        status = "outdated";
      }
    }, definition.refreshIntervalMillis);
  }

  let instancePromise = new Promise<T>((resolve, reject) => {
    definition
      .refresh()
      .then(res => {
        instance = res;
        saveLocalCache(definition, res);
        status = "ok";
        lastRefresh = new Date();
        log.atInfo().log(`Initial version of store ${definition.name} has been loaded`);
        scheduleStoreRefresh();

        resolve(res);
      })
      .catch(e => {
        log
          .atWarn()
          .withCause(e)
          .log(`Failed to initialize store ${definition.name}. Attempting to load from local cache`);
        const cachedInstance = loadFromCache(definition);
        if (!cachedInstance) {
          status = "failed";
          reject(
            new Error(
              `Failed to initialize store ${definition.name}. Initial load failed with ${getErrorMessage(
                e
              )} and no local cache found`
            )
          );
        } else {
          log
            .atWarn()
            .log(
              `Initial store update failed, see errors above. Serving local cache of store ${
                definition.name
              } updated at ${cachedInstance.updateDate.toISOString()}`
            );
          instance = cachedInstance.instance;
          lastRefresh = cachedInstance.updateDate;
          status = "outdated";
          scheduleStoreRefresh();
          resolve(cachedInstance.instance);
        }
      });
  });
  return {
    get() {
      if (instance) {
        return Promise.resolve(instance);
      }
      return instancePromise;
    },
    getCurrent() {
      return instance;
    },
    status: () => status,
    lastRefresh: () => lastRefresh,
    stop: () => {
      log.atInfo().log(`Stopping store ${definition.name}`);
      stopping = true;
      if (intervalToClear) {
        clearInterval(intervalToClear);
      } else {
        log.atError().log(`There's no interval for ${definition.name}`);
      }
      status = "stopped";
    },
  };
};
