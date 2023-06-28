import { getErrorMessage, getLog, newError, requireDefined } from "./index";
import * as process from "process";
import { debounce } from "./debounce";
const log = getLog("singleton");

export type CachedValue<T> = (
  | {
      success: true;
      value: T;
      error: never;
    }
  | { success: false; error: any; value: never }
) & {
  // For Singleton with TTL we need to clear it after TTL
  // contains debounced function
  debounceCleanup: () => void;
};

export interface Singleton<T> {
  (): T;
  waitInit: () => Promise<T>;
}

function clearSingleton<T>(globalName: string, cleanupFunc?: (t: T) => {}) {
  log.atInfo().log(`️🚮🚮🚮 ${globalName} deleting stale singleton`);
  const cachedValue = global[`singletons_${globalName}`];
  if (cachedValue?.success) {
    if (cleanupFunc) {
      try {
        cleanupFunc(cachedValue.value);
      } catch (e) {
        log.atError().withCause(e).log(`️🚮🚮🚮 ${globalName} cleanup failed`);
      }
    }
  }
  delete global[`singletons_${globalName}`];
}
export function disableService<T>(globalName: string) {
  process.env[getDisableServiceVar(globalName)] = "true";
}

function getDisableServiceVar(globalName: string) {
  return `DISABLE_SERVICE_${globalName.toLowerCase()}`;
}

export function getSingleton<T>(
  globalName: string,
  factory: () => T | Promise<T>,
  opts: { ttlSec: number; errorTtlSec?: number; cleanupFunc?: (t: T) => {} } = { ttlSec: 0, errorTtlSec: 0 }
): Singleton<T> {
  const disableServiceVar = getDisableServiceVar(globalName);
  if (process.env[disableServiceVar]) {
    log.atInfo().log(`️🚮🚮🚮 ${globalName} disabled by setting ${disableServiceVar}`);
    const singleton: Partial<Singleton<T>> = () =>
      Promise.reject<T>(
        new Error(`️${globalName} disabled by setting by ${disableServiceVar} env var. waitInit() should not be called`)
      );
    singleton.waitInit = () =>
      Promise.reject(
        new Error(`️${globalName} disabled by setting by ${disableServiceVar} env var. waitInit() should not be called`)
      );
    return singleton as Singleton<T>;
  }

  const handleSuccess = (value: T, startedAtTs: number): T => {
    global[`singletons_${globalName}`] = {
      success: true,
      value,
      debounceCleanup:
        opts.ttlSec > 0 ? debounce(() => clearSingleton(globalName, opts.cleanupFunc), 1000 * opts.ttlSec) : () => {},
    };
    log.atInfo().log(`️⚡️⚡️⚡️ ${globalName} connected in ${Date.now() - startedAtTs}ms!`);
    return value;
  };

  const handleError = (error: any): any => {
    log.atError().log(`❌ ❌ ❌ ${globalName} connection failed. The application isn't functional.`, error);
    global[`singletons_${globalName}`] = {
      success: false,
      error,
      debounceCleanup:
        opts.errorTtlSec && opts.errorTtlSec > 0
          ? debounce(() => clearSingleton(globalName, opts.cleanupFunc), 1000 * opts.errorTtlSec)
          : () => {},
    };
    if (process.env.FAIL_ON_DB_CONNECTION_ERRORS === "true" || process.env.FAIL_ON_DB_CONNECTION_ERRORS === "1") {
      log.atInfo().log("❌ ❌ ❌ Shutting down the application");
      process.exit(1);
    }
    return error;
  };

  const cachedValue = global[`singletons_${globalName}`] as CachedValue<T> | undefined;
  if (cachedValue?.success) {
    cachedValue.debounceCleanup();
    const result = () => cachedValue.value as T;
    result.waitInit = () => Promise.resolve(cachedValue.value as T);
    return result;
  } else if (cachedValue && !cachedValue.success) {
    cachedValue.debounceCleanup();
    throw newError(
      `${globalName} failed during initialization: ${getErrorMessage(cachedValue.error)}`,
      cachedValue.error
    );
  }
  log.atDebug().log(`Creating ${globalName} connection...`);
  let newInstance: Promise<T> | T;
  const startedAtTs = Date.now();
  try {
    newInstance = factory();
  } catch (error) {
    handleError(error);
    throw error;
  }
  if (newInstance instanceof Promise) {
    const awaiter = newInstance.then(instance => handleSuccess(instance, startedAtTs)).catch(handleError);
    const result = () => {
      const globalInstance = requireDefined(
        global[`singletons_${globalName}`],
        `The ${globalName} connection isn't ready yet`
      );
      globalInstance.debounceCleanup();
      if (globalInstance.success) {
        return globalInstance.value;
      } else {
        throw newError(
          `${globalName} failed during initialization: ${getErrorMessage(globalInstance.error)}`,
          globalInstance.error
        );
      }
    };
    result.waitInit = () => awaiter;
    return result;
  } else {
    handleSuccess(newInstance, startedAtTs);
    const result = () => newInstance as T;
    result.waitInit = () => Promise.resolve(newInstance as T);
    return result;
  }
}
