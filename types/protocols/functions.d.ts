import { AnalyticsServerEvent } from "./analytics";
import { RequestOptions } from "http";

export type SetOpts = { ttlMs?: number } | { ttlSec?: number };

/**
 * A key value store that exposed to a function
 */
interface Store {
  get(key: string): Promise<any>;
  del(key: string): Promise<void>;
  set(key: string, value: any, opts?: SetOpts): Promise<void>;
}

/**
 * Store for incoming events, destination results and function log messages
 */
interface EventsStore {
  log(error: boolean, msg: Record<string, any>): Promise<void>;
}

/**
 * A special properties that user can set on an event to define how
 * event will be processed further
 */
export type EventControlOpts = {
  /**
   * Table name to store event in. Non-SQL destinations might ignore this property
   */
  JITSU_TABLE_NAME?: string;
};

export type AnyEvent = Record<string, any> & EventControlOpts;
export type AnyProps = Record<string, any>;

export type FetchResponse = {
  status: number;
  statusText: string;
  text: () => Promise<string>;
  json: () => Promise<any>;
};

export type FetchOpts = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};
export type FunctionContext = {
  log: {
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    debug: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;
  };
  fetch: (url: string, opts?: FetchOpts, logToRedis?: boolean) => Promise<FetchResponse>;
  store: Store;
};

export type AnonymousEventsStore = {
  addEvent(collectionName: string, anonymousId: string, event: AnalyticsServerEvent, ttlDays: number): Promise<void>;
  evictEvents(collectionName: string, anonymousId: string): Promise<AnalyticsServerEvent[]>;
};

/**
 * Function execution context available for builin functions only
 */
export type SystemContext = {
  $system: {
    anonymousEventsStore: AnonymousEventsStore;
  };
};

export type EventContext = {
  /**
   * Headers of incoming request
   */
  headers: Record<string, string>;
  /**
   * Source of the incoming event
   */
  source?: {
    id: string;
    name?: string;
    domain?: string;
  };
  destination?: {
    id: string;
    type: string;
    updatedAt: Date;
    hash: string;
  };
  connection?: {
    id: string;
    mode?: string;
    options?: any;
  };
};

export type FunctionConfigContext<P extends AnyProps = AnyProps> = {
  props: P;
};

/**
 * Parameters for a function
 */
export type FullContext<P extends AnyProps = AnyProps> = EventContext &
  FunctionContext &
  FunctionConfigContext<P> &
  (SystemContext | {});

//equivalent to returning [] from a function
export type FunctionCommand = "drop";

export type FuncReturn = AnyEvent[] | AnyEvent | null | undefined | FunctionCommand;

export interface JitsuFunction<E extends AnyEvent = AnyEvent, P extends AnyProps = AnyProps> {
  (event: E, ctx: FullContext<P>): Promise<FuncReturn> | FuncReturn;

  displayName?: string;
  //for future use - config schema of the function
  configSchema?: any;

  //It's allowed to use basic JSX
  description?: any;
}

export type BuiltinFunctionName<T extends string = string> = `builtin.${T}`;
export type BuiltinDestinationFunctionName = BuiltinFunctionName<`destination.${string}`>;
export type BuiltinTransformationFunctionName = BuiltinFunctionName<`transformation.${string}`>;
