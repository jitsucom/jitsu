import { getLog } from "juava";
import { Isolate, ExternalCopy, Callback, Reference } from "isolated-vm";
import { EventContext, EventsStore, FetchOpts, FuncReturn, JitsuFunction, Store } from "@jitsu/protocols/functions";
import { DropRetryErrorName, RetryErrorName } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { createFullContext } from "../context";
import { isDropResult } from "../index";
import { functionsLibCode, wrapperCode } from "./lib/udf-wrapper-code";

const log = getLog("udf-wrapper");

export type logType = {
  message: string;
  level: string;
  timestamp: Date;
  type: string;
  data?: any;
};

export type UDFWrapperResult = {
  userFunction: JitsuFunction;
  meta: any;
  close: () => void;
};

const wrapperJs = `
import * as udf from "udf";

const userFunction = udf.default;
const meta = udf.config || {};

if (typeof RetryError === "undefined") {
  global.RetryError = class extends Error {
    constructor(message, options) {
      super(message);
      this.name = options?.drop ? "${DropRetryErrorName}" : "${RetryErrorName}";
    }
  }
}

const wrappedUserFunction = async function (eventcopy, ctxcopy) {
  const c = ctxcopy.copy();
  const ctx = {
    ...c,
    store: {
      ...c.store,
      get: async key => {
        const res = await c.store.get.apply(undefined, [key], { arguments: { copy: true }, result: { promise: true } });
        return res ? JSON.parse(res) : undefined;
      },
    },
    fetch: async (url, opts) => {
      const res = await c.fetch.apply(undefined, [url, opts], { arguments: { copy: true }, result: { promise: true } });
      const r = JSON.parse(res);

      return {
        ...r,
        json: async () => {
          return JSON.parse(r.body);
        },
        text: async () => {
          return r.body;
        },
        arrayBuffer: async () => {
            throw new Error("Method 'arrayBuffer' is not implemented");
        },
        blob: async () => {
            throw new Error("Method 'blob' is not implemented");
        },
        formData: async () => {
            throw new Error("Method 'formData' is not implemented");
        },
        clone: async () => {
            throw new Error("Method 'clone' is not implemented");
        }
      };
    },
  };
  const event = eventcopy.copy();
  if (!userFunction || typeof userFunction !== "function") {
    throw new Error("Function not found. Please export default function.");
  }
  console = {
    ...console,
    log: ctx.log.info,
    error: ctx.log.error,
    warn: ctx.log.warn,
    debug: ctx.log.debug,
    info: ctx.log.info,
    assert: (asrt, ...args) => {
      if (!asrt) {
        ctx.log.error("Assertion failed", ...args);
      }
    },
  };
  return userFunction(event, ctx);
};
export { meta, wrappedUserFunction };
`;

export const UDFWrapper = (functionId, name, functionCode: string): UDFWrapperResult => {
  log.atInfo().log(`[${functionId}] Compiling UDF function '${name}'`);
  const startMs = new Date().getTime();
  try {
    //const wrappedCode = `let exports = {}\n${functionCode}\n${wrapperJs}`;
    const isolate = new Isolate({ memoryLimit: 10 });
    const context = isolate.createContextSync();
    const jail = context.global;

    // This make the global object available in the context as 'global'. We use 'derefInto()' here
    // because otherwise 'global' would actually be a Reference{} object in the new isolate.
    jail.setSync("global", jail.derefInto());

    const functions = isolate.compileModuleSync(functionsLibCode, {
      filename: "functions-lib.js",
    });
    functions.instantiateSync(context, (specifier: string) => {
      throw new Error(`import is not allowed: ${specifier}`);
    });

    const udf = isolate.compileModuleSync(functionCode, { filename: name + ".js" });
    udf.instantiateSync(context, (specifier: string) => {
      if (specifier === "@jitsu/functions-lib") {
        return functions;
      }
      throw new Error(`import is not allowed: ${specifier}`);
    });

    const wrapper = isolate.compileModuleSync(wrapperCode, {
      filename: "jitsu-wrapper.js",
    });
    wrapper.instantiateSync(context, (specifier: string) => {
      if (specifier === "udf") {
        return udf;
      }
      if (specifier === "@jitsu/functions-lib") {
        return functions;
      }
      throw new Error(`import is not allowed: ${specifier}`);
    });
    wrapper.evaluateSync();
    const exported = wrapper.namespace;

    const ref = exported.getSync("wrappedUserFunction", {
      reference: true,
    });
    if (!ref || ref.typeof !== "function") {
      throw new Error("Function not found. Please export default function.");
    }
    const meta = exported.getSync("meta", {
      copy: true,
    });
    const userFunction: JitsuFunction = async (event, ctx) => {
      if (isolate.isDisposed) {
        throw new Error("Isolate is disposed");
      }
      try {
        const res = await ref.apply(
          undefined,
          [
            new ExternalCopy(event),
            new ExternalCopy({
              ...ctx,
              log: {
                info: new Callback(ctx.log.info),
                warn: new Callback(ctx.log.warn),
                debug: new Callback(ctx.log.debug),
                error: new Callback(ctx.log.error),
              },
              fetch: new Reference(async (url: string, opts?: FetchOpts) => {
                const res = await ctx.fetch(url, opts);
                const headers: any = {};
                res.headers.forEach((v, k) => {
                  headers[k] = v;
                });
                const text = await res.text();
                const j = {
                  status: res.status,
                  statusText: res.statusText,
                  type: res.type,
                  redirected: res.redirected,
                  body: text,
                  bodyUsed: true,
                  url: res.url,
                  ok: res.ok,
                  headers: headers,
                };
                return JSON.stringify(j);
              }),
              store: {
                get: new Reference(async (key: string) => {
                  const res = await ctx.store.get(key);
                  return JSON.stringify(res);
                }),
                set: new Callback(ctx.store.set, { ignored: true }),
                del: new Callback(ctx.store.del, { ignored: true }),
              },
            }),
          ],
          {
            result: { promise: true },
          }
        );
        switch (typeof res) {
          case "undefined":
            return undefined;
          case "string":
          case "number":
          case "boolean":
            return res;
          default:
            return (res as Reference).copy();
        }
      } catch (e: any) {
        if (isolate.isDisposed) {
          throw new Error("Isolate is disposed");
        }
        if (meta) {
          e.retryPolicy = meta.retryPolicy;
        }
        //log.atInfo().log(`ERROR name: ${e.name} message: ${e.message} json: ${e.stack}`);
        throw e;
      }
    };
    log.atInfo().log(`[${functionId}] udf compile time ${new Date().getTime() - startMs}ms`);
    return {
      userFunction,
      meta,
      close: () => {},
    };
  } catch (e) {
    return {
      userFunction: () => {
        throw new Error(`Cannot compile function: ${e}`);
      },
      meta: {},
      close: () => {},
    };
  }
};

export type UDFTestRequest = {
  functionId: string;
  functionName: string;
  code: string | UDFWrapperResult;
  event: AnalyticsServerEvent;
  config: any;
  store: any;
  workspaceId: string;
};

export type UDFTestResponse = {
  error?: {
    message: string;
    stack?: string;
    name: string;
    retryPolicy?: any;
  };
  dropped?: boolean;
  result: FuncReturn;
  store: any;
  logs: logType[];
  meta: any;
};

export async function UDFTestRun({
  functionId: id,
  functionName: name,
  code,
  store,
  event,
  config,
}: UDFTestRequest): Promise<UDFTestResponse> {
  const logs: logType[] = [];
  let wrapper: UDFWrapperResult | undefined = undefined;
  try {
    const eventContext: EventContext = {
      geo: {
        country: {
          code: "US",
          isEU: false,
        },
        city: {
          name: "New York",
        },
        region: {
          code: "NY",
        },
        location: {
          latitude: 40.6808,
          longitude: -73.9701,
        },
        postalCode: {
          code: "11238",
        },
      },
      headers: {},
      source: {
        id: "functionsDebugger-streamId",
      },
      destination: {
        id: "functionsDebugger-destinationId",
        type: "clickhouse",
        updatedAt: new Date(),
        hash: "hash",
      },
      connection: {
        id: "functionsDebugger",
      },
    };

    const storeImpl: Store = {
      get: async (key: string) => {
        return store[key];
      },
      set: async (key: string, obj: any) => {
        store[key] = obj;
      },
      del: async (key: string) => {
        delete store[key];
      },
    };
    const eventsStore: EventsStore = {
      log(connectionId: string, error: boolean, msg: Record<string, any>) {
        switch (msg.type) {
          case "log-info":
          case "log-warn":
          case "log-debug":
          case "log-error":
            logs.push({
              message:
                msg.message?.text +
                (Array.isArray(msg.message?.args) && msg.message.args.length > 0
                  ? `, ${msg.message?.args.join(",")}`
                  : ""),
              level: msg.type.replace("log-", ""),
              timestamp: new Date(),
              type: "log",
            });
            break;
          case "http-request":
            let statusText;
            if (msg.error) {
              statusText = `${msg.error}`;
            } else {
              statusText = `${msg.statusText ?? ""}${msg.status ? `(${msg.status})` : ""}`;
            }
            logs.push({
              message: `${msg.method} ${msg.url} :: ${statusText}`,
              level: msg.error ? "error" : "info",
              timestamp: new Date(),
              type: "http",
              data: {
                body: msg.body,
                headers: msg.headers,
                response: msg.response,
              },
            });
        }
      },
    };
    const ctx = createFullContext(id, eventsStore, storeImpl, eventContext, {}, config);
    if (typeof code === "string") {
      wrapper = UDFWrapper(id, name, code);
    } else {
      wrapper = code;
    }
    const result = await wrapper?.userFunction(event, ctx);
    return {
      dropped: isDropResult(result),
      result: typeof result === "undefined" ? event : result,
      store: store,
      logs,
      meta: wrapper?.meta,
    };
  } catch (e: any) {
    return {
      error: {
        message: e.message,
        stack: e.stack,
        name: e.name,
        retryPolicy: e.retryPolicy,
      },
      result: {},
      store: store ?? {},
      logs,
      meta: wrapper?.meta,
    };
  }
}
