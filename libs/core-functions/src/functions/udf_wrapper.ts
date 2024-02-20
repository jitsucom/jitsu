import { getLog } from "juava";
import { Isolate, ExternalCopy, Callback, Reference } from "isolated-vm";
import { EventContext, EventsStore, FetchOpts, FuncReturn, JitsuFunction, Store } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { createFullContext } from "../context";
import { createMemoryStore, isDropResult, memoryStoreDump } from "../index";
import { functionsLibCode, wrapperCode } from "./lib/udf-wrapper-code";
import { parseUserAgent } from "./lib/ua";

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

export const UDFWrapper = (functionId, name, functionCode: string): UDFWrapperResult => {
  log.atInfo().log(`[${functionId}] Compiling UDF function '${name}'`);
  const startMs = new Date().getTime();
  let isolate: Isolate;
  try {
    //const wrappedCode = `let exports = {}\n${functionCode}\n${wrapperJs}`;
    isolate = new Isolate({ memoryLimit: 128 });
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
                ttl: new Reference(async (key: string) => {
                  return await ctx.store.ttl(key);
                }),
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
      close: () => {
        try {
          if (isolate) {
            isolate.dispose();
            log.atInfo().log(`[${functionId}] isolate closed.`);
          }
        } catch (e) {
          log.atError().log(`[${functionId}] Error while closing isolate: ${e}`);
        }
      },
    };
  } catch (e) {
    return {
      userFunction: () => {
        throw new Error(`Cannot compile function: ${e}`);
      },
      meta: {},
      close: () => {
        try {
          if (isolate) {
            isolate.dispose();
            log.atInfo().log(`[${functionId}] isolate closed`);
          }
        } catch (e) {
          log.atError().log(`[${functionId}] Error while closing isolate: ${e}`);
        }
      },
    };
  }
};

export type UDFTestRequest = {
  functionId: string;
  functionName: string;
  code: string | UDFWrapperResult;
  event: AnalyticsServerEvent;
  config: any;
  store: Store | any;
  workspaceId: string;
  userAgent?: string;
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
  userAgent,
}: UDFTestRequest): Promise<UDFTestResponse> {
  const logs: logType[] = [];
  let wrapper: UDFWrapperResult | undefined = undefined;
  let realStore = false;
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
      ua: parseUserAgent(
        event.context?.userAgent ||
          userAgent ||
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
      ),
      headers: {},
      source: {
        id: "functionsDebugger-streamId",
        type: "browser",
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
    let storeImpl: Store;
    if (
      typeof store?.set === "function" &&
      typeof store?.get === "function" &&
      typeof store?.del === "function" &&
      typeof store.ttl === "function"
    ) {
      storeImpl = store;
      realStore = true;
    } else {
      store = store || {};
      storeImpl = createMemoryStore(store);
    }

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
      close() {},
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
      store: !realStore ? memoryStoreDump(store) : {},
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
      store: !realStore && store ? memoryStoreDump(store) : {},
      logs,
      meta: wrapper?.meta,
    };
  }
}
