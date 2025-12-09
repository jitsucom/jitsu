import { FuncReturn } from "@jitsu/protocols/functions";

export function isDropResult(result: FuncReturn): boolean {
  return result === "drop" || (Array.isArray(result) && result.length === 0) || result === null || result === false;
}

export {
  makeLog,
  makeFetch,
  MultiEventsStore,
  DummyEventsStore,
  wrapperFunction,
  eventTimeSafeMs,
  getPageOrScreenProps,
  getEventCustomProperties,
  getTraits,
  createFilter,
} from "./functions/lib/index";

export type {
  MetricsMeta,
  RotorMetrics,
  StoreMetrics,
  FuncChainResult,
  FunctionExecLog,
  FunctionExecRes,
  FunctionContext,
  FunctionChainContext,
  FetchType,
  EventsStore,
  JitsuFunctionWrapper,
  InternalFetchType,
  logType,
} from "./functions/lib/index";
export * from "./functions/lib/store";
export * from "./functions/lib/strings";
export * from "./functions/lib/ua";
export * from "./functions/lib/browser";
export * from "./functions/lib/json-fetch";
export * from "./lib/inmem-store";
export * from "./lib/config-types";
export * from "./lib/entity-store";
