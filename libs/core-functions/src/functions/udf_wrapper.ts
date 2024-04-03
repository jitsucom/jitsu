import { getLog, LogLevel, sanitize, stopwatch } from "juava";
import { Isolate, ExternalCopy, Callback, Reference, Module, Context } from "isolated-vm";
import { EventContext, FetchOpts, FuncReturn, JitsuFunction, Store } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { createFullContext, EventsStore } from "../context";
import { createMemoryStore, isDropResult, memoryStoreDump } from "../index";
import { functionsLibCode, chainWrapperCode } from "./lib/udf-wrapper-code";
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
  close: () => void;
};

export type UDFFunction = {
  id: string;
  name: string;
  code: string;
};

export const UDFWrapper = (connectionId: string, functions: UDFFunction[]): UDFWrapperResult => {
  log.atInfo().log(`[${connectionId}] Compiling ${functions.length} UDF functions`);
  const sw = stopwatch();
  let isolate: Isolate;
  let context: Context;
  try {
    isolate = new Isolate({ memoryLimit: 128 });
    context = isolate.createContextSync();
    const jail = context.global;

    // This make the global object available in the context as 'global'. We use 'derefInto()' here
    // because otherwise 'global' would actually be a Reference{} object in the new isolate.
    jail.setSync("global", jail.derefInto());

    const functionsLib = isolate.compileModuleSync(functionsLibCode, {
      filename: "functions-lib.js",
    });
    functionsLib.instantiateSync(context, (specifier: string) => {
      throw new Error(`import is not allowed: ${specifier}`);
    });
    const udfModules: Record<string, Module> = {};
    for (let i = 0; i < functions.length; i++) {
      const sw = stopwatch();
      const f = functions[i];
      log.atDebug().log(`[CON:${connectionId}]: [f:${f.id}] Compiling UDF function '${f.name}'`);
      const moduleName = sanitize(f.name, "_") + "_" + f.id;
      const udf = isolate.compileModuleSync(f.code, { filename: moduleName + ".js" });
      udf.instantiateSync(context, (specifier: string) => {
        if (specifier === "@jitsu/functions-lib") {
          return functionsLib;
        }
        throw new Error(`import is not allowed: ${specifier}`);
      });
      udfModules[moduleName] = udf;
      log.atDebug().log(`[${connectionId}] [f:${f.id}] UDF function '${f.name}' compiled in ${sw.elapsedPretty()}`);
    }

    let code = chainWrapperCode.replace(
      "//** @UDF_FUNCTIONS_IMPORT **//",
      Object.keys(udfModules)
        .map(m => `import * as ${m} from "${m}";\n`)
        .join("")
    );
    code = code.replace(
      "//** @UDF_FUNCTIONS_CHAIN **//",
      "chain = [" +
        Object.keys(udfModules)
          .map(m => {
            const id = m.split("_").pop();
            return `{id: "${id}", meta: ${m}.config, f: wrappedUserFunction("${id}", ${m}.default)}`;
          })
          .join(",") +
        "];"
    );
    const wrapper = isolate.compileModuleSync(code, {
      filename: "jitsu-wrapper.js",
    });
    wrapper.instantiateSync(context, (specifier: string) => {
      const udf = udfModules[specifier];
      if (udf) {
        //log.atInfo().log(`[${connectionId}] UDF function '${specifier}' is imported`);
        return udf;
      }
      if (specifier === "@jitsu/functions-lib") {
        return functionsLib;
      }
      throw new Error(`import is not allowed: ${specifier}`);
    });
    wrapper.evaluateSync();
    const wrapperFunc = wrap(connectionId, isolate, context, wrapper);
    log.atInfo().log(`[${connectionId}] total UDF compile time: ${sw.elapsedPretty()}`);
    return wrapperFunc;
  } catch (e) {
    return {
      userFunction: () => {
        throw new Error(`Cannot compile function: ${e}`);
      },
      close: () => {
        try {
          if (isolate) {
            context.release();
            isolate.dispose();
            log.atInfo().log(`[${connectionId}] isolate closed`);
          }
        } catch (e) {
          log.atError().log(`[${connectionId}] Error while closing isolate: ${e}`);
        }
      },
    };
  }
};

function wrap(connectionId: string, isolate: Isolate, context: Context, wrapper: Module) {
  const exported = wrapper.namespace;

  const ref = exported.getSync("wrappedFunctionChain", {
    reference: true,
  });
  if (!ref || ref.typeof !== "function") {
    throw new Error("Function not found. Please export wrappedFunctionChain function.");
  }
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
            fetch: new Reference(async (url: string, opts?: FetchOpts, extra?: any) => {
              const res = await ctx.fetch(url, opts, extra);
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
      const m = e.message;
      if (m.startsWith("{")) {
        throw JSON.parse(m);
      }
      //log.atInfo().log(`ERROR name: ${e.name} message: ${e.message} json: ${e.stack}`);
      throw e;
    }
  };
  return {
    userFunction,
    close: () => {
      try {
        if (isolate) {
          context.release();
          isolate.dispose();
          log.atInfo().log(`[${connectionId}] isolate closed.`);
        }
      } catch (e) {
        log.atError().log(`[${connectionId}] Error while closing isolate: ${e}`);
      }
    },
  };
}

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
      log(connectionId: string, level: LogLevel, msg: Record<string, any>) {
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
      wrapper = UDFWrapper(id, [{ id, name, code }]);
    } else {
      wrapper = code;
    }
    const result = await wrapper?.userFunction(event, ctx);
    return {
      dropped: isDropResult(result),
      result: typeof result === "undefined" ? event : result,
      store: !realStore ? memoryStoreDump(store) : {},
      logs,
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
    };
  }
}
