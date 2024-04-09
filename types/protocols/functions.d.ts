import { AnalyticsServerEvent, Geo } from "./analytics";

/**
 * Store set options: ttl in seconds or string representation of duration (e.g. "1d")
 */
export type SetOpts = number | string | { ttl: number };

/**
 * A key value store that exposed to a function
 */
export interface Store {
  get(key: string): Promise<any>;
  // getWithMeta(key: string): Promise<{
  //   value: any;
  //   lastUpdated: Date
  //   initialTTLSeconds: number
  //   leftTTLSeconds: number
  // } | undefined>;
  del(key: string): Promise<void>;
  set(key: string, value: any, opts?: SetOpts): Promise<void>;
  ttl(key: string): Promise<number>;
}

export interface Metrics {
  counter(name: string): {
    //increment / decrement counter. Supports negative values
    inc: (value: number) => void;
  };
  gauge(name: string): {
    set: (value: number) => void;
    //increment / decrement counter. Supports negative values
    inc: (value: number) => void;
  };
}

export interface TTLStore extends Store {
  getWithTTL(key: string): Promise<{ value: any; ttl: number } | undefined>;
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

export type FetchResponse = Response;

export type FetchType = (url: string, opts?: FetchOpts, extras?: any) => Promise<FetchResponse>;

export type FetchOpts = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
};
export type FunctionLogger<Sync extends boolean = false> = {
  info: (message: string, ...args: any[]) => void | Promise<void>;
  warn: (message: string, ...args: any[]) => void | Promise<void>;
  debug: (message: string, ...args: any[]) => void | Promise<void>;
  error: (message: string, ...args: any[]) => void | Promise<void>;
};
export type FunctionContext = {
  log: FunctionLogger;
  fetch: FetchType;
  store: TTLStore;
  metrics?: Metrics;
};

export type PrivacyOpts = {
  /**
   * IP address processing mode
   * "keep" means that the IP address will be kept as is
   * "reduce" means that the IP address will be reduced to the first 3 octets
   * "hash" means that the IP address will be hashed with SHA256 (not implemented yet)
   *
   * "reduce" is the default behavior
   */
  ip?: "reduce" | "keep" | "hash";
  /**
   * Replaces cookie based anonymous ID with a fingerprint hash
   * "hash1" means that anyonymous ID will be replaced with hash(ip + user_agent)
   */
  anonymousId?: "hash1" | "keep" | ((opts: { ip: string; ip3octets: string; userAgent: string }) => string);
};

export type CoreLib = {
  privacy(event: AnalyticsServerEvent, opts?: PrivacyOpts): AnalyticsServerEvent;
};

export type AnonymousEventsStore = {
  addEvent(collectionName: string, anonymousId: string, event: AnalyticsServerEvent, ttlDays: number): Promise<void>;
  evictEvents(collectionName: string, anonymousId: string): Promise<AnalyticsServerEvent[]>;
};

export type UserAgent = {
  browser: {
    name: string;
    version: string;
    major: string; //@deprecated
  };
  engine: {
    name: string;
    version: string;
  };
  os: {
    name: string;
    version: string;
  };
  device: {
    model: string;
    type: "console" | "mobile" | "tablet" | "smarttv" | "wearable" | "embedded" | "desktop";
    vendor: string;
  };
  cpu: {
    architecture: string;
  };
  bot?: boolean;
};

export type EventContext = {
  /**
   * Geo data of incoming request
   */
  geo?: Geo;
  /**
   * Parsed User Agent of incoming request
   */
  ua?: UserAgent;
  /**
   * Headers of incoming request
   */
  headers: Record<string, string>;
  /**
   * Source of the incoming event
   */
  source: {
    id: string;
    name?: string;
    //if request was sent from browser or server-to-server api
    type: "browser" | "s2s";
    domain?: string;
  };
  destination: {
    id: string;
    type: string;
    updatedAt?: Date;
    hash: string;
  };
  connection: {
    id: string;
    mode?: string;
    options?: any;
  };
  workspace: {
    id: string;
  };
  // number of retries attempted
  retries?: number;
};

export type FunctionConfigContext<P extends AnyProps = AnyProps> = {
  props: P;
};

/**
 * Parameters for a function
 */
export type FullContext<P extends AnyProps = AnyProps> = EventContext & FunctionContext & FunctionConfigContext<P>;

//equivalent to returning [] from a function
export type FunctionCommand = "drop";

export type FuncReturn = AnyEvent[] | AnyEvent | null | undefined | FunctionCommand | false;

export type SyncFunction<
  Dest extends AnyProps = AnyProps,
  Cred extends AnyProps = AnyProps,
  SyncProps extends AnyProps = AnyProps
> = (p: {
  source: { package: string; credentials: Cred; syncProps: SyncProps };
  destination: Dest;
  ctx: {
    log: FunctionLogger;
    store: Store;
  };
}) => Promise<void>;

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
