import { getLog, parseNumber, sanitize, stopwatch } from "juava";
import { Isolate, ExternalCopy, Reference, Module, Context } from "isolated-vm";
import { FetchOpts } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";

import { FunctionChainContext, FunctionContext, cryptoCode } from "@jitsu/core-functions";
import { RetryError } from "@jitsu/functions-lib";
import { clearTimeout } from "node:timers";
import * as crypto from "node:crypto";
import { ProfileResult } from "@jitsu/protocols/profile";
import { chainWrapperCode, functionsLibCode } from "./udf-wrapper-code";

const log = getLog("udf-wrapper");

export type ProfileUser = {
  userId: string;
  anonymousId: string;
  traits: Record<string, any>;
};

export type ProfileFunctionWrapper = (
  context: FunctionContext,
  events: AnalyticsServerEvent[],
  user: ProfileUser
) => Promise<ProfileResult | undefined>;

export type UDFWrapperResult = {
  userFunction: ProfileFunctionWrapper;
  isDisposed: () => boolean;
  close: () => void;
};

export type UDFFunction = {
  id: string;
  name: string;
  code: string;
};

export const UDFWrapper = (
  profileBulderId: string,
  chainCtx: FunctionChainContext,
  funcCtx: FunctionContext,
  functions: UDFFunction[]
): UDFWrapperResult => {
  log.atInfo().log(`[CON:${profileBulderId}] Compiling ${functions.length} UDF functions`);
  const sw = stopwatch();
  let isolate: Isolate;
  let context: Context;
  let refs: Reference[] = [];
  try {
    isolate = new Isolate({ memoryLimit: 512 });
    context = isolate.createContextSync();
    const jail = context.global;

    // This make the global object available in the context as 'global'. We use 'derefInto()' here
    // because otherwise 'global' would actually be a Reference{} object in the new isolate.
    jail.setSync("global", jail.derefInto());

    jail.setSync("_jitsu_funcCtx", new ExternalCopy(funcCtx).copyInto({ release: true, transferIn: true }));
    jail.setSync(
      "_jitsu_log",
      new ExternalCopy({
        info: makeReference(refs, chainCtx.log.info),
        warn: makeReference(refs, chainCtx.log.warn),
        debug: makeReference(refs, chainCtx.log.debug),
        error: makeReference(refs, chainCtx.log.error),
      }).copyInto({ release: true, transferIn: true })
    );
    jail.setSync("_jitsu_fetch_log_level", chainCtx.connectionOptions?.fetchLogLevel || "info");
    jail.setSync(
      "_jitsu_crypto",
      makeReference(refs, {
        hash: crypto["hash"],
        randomUUID: crypto.randomUUID,
        randomBytes: crypto.randomBytes,
        randomInt: crypto.randomInt,
      })
    );
    jail.setSync("require", () => {
      throw new Error("'require' is not supported. Please use 'import' instead");
    });
    jail.setSync(
      "_jitsu_fetch",
      makeReference(refs, async (url: string, opts?: FetchOpts, extra?: any) => {
        const res = await chainCtx.fetch(url, opts, extra);
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
      })
    );
    jail.setSync(
      "_jitsu_store",
      new ExternalCopy({
        get: makeReference(refs, async (key: string) => {
          const res = await chainCtx.store.get(key);
          return JSON.stringify(res);
        }),
        set: makeReference(refs, chainCtx.store.set),
        del: makeReference(refs, chainCtx.store.del),
        ttl: makeReference(refs, async (key: string) => {
          return await chainCtx.store.ttl(key);
        }),
      }).copyInto({ release: true, transferIn: true })
    );

    const functionsLib = isolate.compileModuleSync(functionsLibCode, {
      filename: "functions-lib.js",
    });
    functionsLib.instantiateSync(context, (specifier: string): Module => {
      throw new Error(`import is not allowed: ${specifier}`);
    });
    const cryptoLib = isolate.compileModuleSync(cryptoCode, {
      filename: "crypto.js",
    });
    cryptoLib.instantiateSync(context, (specifier: string): Module => {
      throw new Error(`import is not allowed: ${specifier}`);
    });
    const udfModules: Record<string, Module> = {};
    for (let i = 0; i < functions.length; i++) {
      const sw = stopwatch();
      const f = functions[i];
      log.atDebug().log(`[CON:${profileBulderId}]: [f:${f.id}] Compiling UDF function '${f.name}'`);
      const moduleName = "f_" + sanitize(f.name, "_") + "_" + f.id;
      const udf = isolate.compileModuleSync(f.code, { filename: moduleName + ".js" });
      udf.instantiateSync(context, (specifier: string) => {
        if (specifier === "@jitsu/functions-lib") {
          return functionsLib;
        } else if (specifier === "crypto") {
          return cryptoLib;
        }
        throw new Error(`import is not allowed: ${specifier}`);
      });
      udfModules[moduleName] = udf;
      log
        .atDebug()
        .log(`[CON:${profileBulderId}] [f:${f.id}] UDF function '${f.name}' compiled in ${sw.elapsedPretty()}`);
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
            return `{id: "${id}", meta: ${m}.config, f: wrappedUserFunction("${id}", ${m}.default, { props: _jitsu_funcCtx.props, function:{ ..._jitsu_funcCtx.function, id: "${id}"}})}`;
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
    const wrapperFunc = wrap(profileBulderId, isolate, context, wrapper);
    log.atInfo().log(`[CON:${profileBulderId}] total UDF compile time: ${sw.elapsedPretty()}`);
    return wrapperFunc;
  } catch (e) {
    return {
      userFunction: (): Promise<ProfileResult> => {
        throw new Error(`Cannot compile function: ${e}`);
      },
      isDisposed: () => {
        return false;
      },
      close: () => {
        try {
          if (isolate) {
            for (const r of refs) {
              r.release();
            }
            context.release();
            isolate.dispose();
            log.atInfo().log(`[${profileBulderId}] isolate closed`);
          }
        } catch (e) {
          log.atError().log(`[${profileBulderId}] Error while closing isolate: ${e}`);
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
  const userFunction: ProfileFunctionWrapper = async (ctx, events, user): Promise<ProfileResult | undefined> => {
    if (isolate.isDisposed) {
      throw new RetryError("Isolate is disposed", { drop: true });
    }
    const eventCopy = new ExternalCopy(events);
    const ctxCopy = new ExternalCopy(ctx);
    const userCopy = new ExternalCopy(user);

    const udfTimeoutMs = parseNumber(process.env.UDF_TIMEOUT_MS, 5000);
    let isTimeout = false;
    const timer = setTimeout(() => {
      isTimeout = true;
      isolate.dispose();
    }, udfTimeoutMs);
    try {
      const res = await ref.apply(
        undefined,
        [
          ctxCopy.copyInto({ release: true, transferIn: true }),
          eventCopy.copyInto({ release: true, transferIn: true }),
          userCopy.copyInto({ release: true, transferIn: true }),
        ],
        {
          result: { promise: true },
        }
      );
      switch (typeof res) {
        case "undefined":
        case "string":
        case "number":
        case "boolean":
          return undefined;
        default:
          const r = (res as Reference).copy();
          (res as Reference).release();
          return r;
      }
    } catch (e: any) {
      if (isolate.isDisposed) {
        if (isTimeout) {
          throw new RetryError(
            `[${connectionId}] Function execution took longer than ${udfTimeoutMs}ms. Isolate is disposed`,
            {
              drop: true,
            }
          );
        } else {
          throw new RetryError(
            `[${connectionId}] Function execution stopped probably due to high memory usage. Isolate is disposed.`,
            {
              drop: true,
            }
          );
        }
      }
      const m = e.message;
      if (m.startsWith("{")) {
        throw JSON.parse(m);
      }
      //log.atInfo().log(`ERROR name: ${e.name} message: ${e.message} json: ${e.stack}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    userFunction,
    isDisposed: () => {
      if (isolate) {
        return isolate.isDisposed;
      }
      return true;
    },
    close: () => {
      try {
        if (isolate) {
          context.release();
          if (!isolate.isDisposed) {
            isolate.dispose();
          }
          log.atInfo().log(`[${connectionId}] isolate closed.`);
        }
      } catch (e) {
        log.atError().log(`[${connectionId}] Error while closing isolate: ${e}`);
      }
    },
  };
}

function makeReference(refs: Reference[], obj: any): Reference {
  const ref = new Reference(obj);
  refs.push(ref);
  return ref;
}
//
// export type UDFTestRequest = {
//   functionId: string;
//   functionName: string;
//   code: string | UDFWrapperResult;
//   event: AnalyticsServerEvent;
//   config: any;
//   store: Store | any;
//   workspaceId: string;
//   userAgent?: string;
// };
//
// export type UDFTestResponse = {
//   error?: {
//     message: string;
//     stack?: string;
//     name: string;
//     retryPolicy?: any;
//   };
//   dropped?: boolean;
//   result: FuncReturn;
//   store: any;
//   logs: logType[];
// };
//
// export async function UDFTestRun({
//   functionId: id,
//   functionName: name,
//   code,
//   store,
//   event,
//   config,
//   userAgent,
//   workspaceId,
// }: UDFTestRequest): Promise<UDFTestResponse> {
//   const logs: logType[] = [];
//   let wrapper: UDFWrapperResult | undefined = undefined;
//   let realStore = false;
//   try {
//     const eventContext: EventContext = {
//       geo: {
//         country: {
//           code: "US",
//           name: "United States",
//           isEU: false,
//         },
//         city: {
//           name: "New York",
//         },
//         region: {
//           code: "NY",
//         },
//         location: {
//           latitude: 40.6808,
//           longitude: -73.9701,
//         },
//         postalCode: {
//           code: "11238",
//         },
//       },
//       ua: parseUserAgent(
//         event.context?.userAgent ||
//           userAgent ||
//           "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"
//       ),
//       headers: {},
//       source: {
//         id: "functionsDebugger-streamId",
//         type: "browser",
//       },
//       destination: {
//         id: "functionsDebugger-destinationId",
//         type: "clickhouse",
//         updatedAt: new Date(),
//         hash: "hash",
//       },
//       connection: {
//         id: "functionsDebugger",
//       },
//       workspace: {
//         id: workspaceId,
//       },
//     };
//     let storeImpl: TTLStore;
//     if (
//       typeof store?.set === "function" &&
//       typeof store?.get === "function" &&
//       typeof store?.del === "function" &&
//       typeof store.ttl === "function"
//     ) {
//       storeImpl = store;
//       realStore = true;
//     } else {
//       store = store || {};
//       storeImpl = createMemoryStore(store);
//     }
//
//     const eventsStore: EventsStore = {
//       log(connectionId: string, level: LogLevel, msg: Record<string, any>) {
//         switch (msg.type) {
//           case "log-info":
//           case "log-warn":
//           case "log-debug":
//           case "log-error":
//             logs.push({
//               message:
//                 msg.message?.text +
//                 (Array.isArray(msg.message?.args) && msg.message.args.length > 0
//                   ? `, ${msg.message?.args.join(",")}`
//                   : ""),
//               level: msg.type.replace("log-", ""),
//               timestamp: new Date(),
//               type: "log",
//             });
//             break;
//           case "http-request":
//             let statusText;
//             if (msg.error) {
//               statusText = `${msg.error}`;
//             } else {
//               statusText = `${msg.statusText ?? ""}${msg.status ? `(${msg.status})` : ""}`;
//             }
//             logs.push({
//               message: `${msg.method} ${msg.url} :: ${statusText}`,
//               level: msg.error ? "error" : "debug",
//               timestamp: new Date(),
//               type: "http",
//               data: {
//                 body: msg.body,
//                 headers: msg.headers,
//                 response: msg.response,
//               },
//             });
//         }
//       },
//       close() {},
//     };
//     const chainCtx: FunctionChainContext = {
//       store: storeImpl,
//       fetch: makeFetch("functionsDebugger", eventsStore, "info"),
//       log: makeLog("functionsDebugger", eventsStore),
//     };
//     const d = new Date();
//     d.setDate(d.getDate() + 1);
//     const funcCtx: FunctionContext = {
//       function: {
//         type: "udf",
//         id,
//         debugTill: d,
//       },
//       props: config,
//     };
//     if (typeof code === "string") {
//       wrapper = UDFWrapper(id, chainCtx, funcCtx, [{ id, name, code }]);
//     } else {
//       wrapper = code;
//     }
//     const result = await wrapper?.userFunction(eventContext, event);
//     return {
//       dropped: isDropResult(result),
//       result: typeof result === "undefined" ? event : result,
//       store: !realStore ? memoryStoreDump(store) : {},
//       logs,
//     };
//   } catch (e: any) {
//     return {
//       error: {
//         message: e.message,
//         stack: e.stack,
//         name: e.name,
//         retryPolicy: e.retryPolicy,
//       },
//       result: {},
//       store: !realStore && store ? memoryStoreDump(store) : {},
//       logs,
//     };
//   }
// }
