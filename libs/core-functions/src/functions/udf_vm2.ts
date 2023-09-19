import { NodeVM } from "vm2";
import { getLog } from "juava";
import * as swc from "@swc/core";
import { EventContext, EventsStore, FuncReturn, JitsuFunction, Store } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { createFullContext } from "../context";
import { isDropResult } from "../index";

const log = getLog("udf-vm2-wrapper");

function mockModule(moduleName, knownSymbols) {
  return new Proxy(
    {},
    {
      set(target, prop, value, receiver) {
        throw new Error(`Called ${moduleName}.${prop.toString()} with ${value} & ${receiver}`);
      },
      get: (target, prop) => {
        let known = knownSymbols[prop.toString()];
        if (known) {
          return known;
        } else {
          throw new Error(
            `Attempt to access ${moduleName}.${prop.toString()}, which is not safe. Allowed symbols: [${Object.keys(
              knownSymbols
            )}]`
          );
        }
      },
    }
  );
}

function throwOnMethods(module, members) {
  return members.reduce((obj, key) => ({ ...obj, [key]: throwOnCall(module, key) }), {});
}

function throwOnCall(module, prop) {
  return (...args) => {
    throw new Error(`Call to ${module}.${prop} is not allowed. Call arguments: ${[...args].join(", ")}`);
  };
}

export type logType = {
  message: string;
  level: string;
  timestamp: Date;
  type: string;
  data?: any;
};

export const UDFWrapper = (
  functionId,
  name,
  functionCode: string
): { close: () => void; userFunction: JitsuFunction } => {
  log.atInfo().log(`[${functionId}] Compiling UDF function '${name}'`);

  const startMs = new Date().getTime();
  try {
    functionCode = swc.transformSync(functionCode, {
      filename: `index.js`,
      module: { type: "commonjs" },
    }).code;
    // functionCode = transformSync(functionCode, {
    //   presets: [preset],
    //   filename: `index.js`,
    //   plugins: [plugin],
    // }).code;
    const vm = new NodeVM({
      require: {
        external: [functionId],
        context: "sandbox",
        builtin: [
          "stream",
          "http",
          "url",
          "http2",
          "dns",
          "punycode",
          "https",
          "zlib",
          "events",
          "net",
          "tls",
          "buffer",
          "string_decoder",
          "assert",
          "util",
          "crypto",
          "path",
          "tty",
          "querystring",
        ],
        root: "./",

        mock: {
          fs: mockModule("fs", {
            ...throwOnMethods("fs", ["readFile", "realpath", "lstat", "__esModule"]),
          }),
        },
      },
    });

    //const userFunction = vm.run(functionCode, `${functionId}.js`);
    const userFunction = vm.run(
      `${functionCode}
const exported = module.exports;
let userFunction;
if (typeof exported === "function") {
  userFunction = exported;
} else {
  userFunction = exported.default;
  if (!userFunction && Object.keys(exported).length === 1) {
    userFunction = exported[Object.keys(exported)[0]];
  }
}
const wrapped = async function(event, ctx) {
  if (!userFunction || typeof userFunction !== "function") {
      throw new Error("Function not found. Please export default function.");
  }
  console = {...console,
    log: ctx.log.info,
    error: ctx.log.error,
    warn: ctx.log.warn,
    debug: ctx.log.debug,
    info: ctx.log.info,
    assert: (asrt, ...args) => {
       if (!asrt) {
          ctx.log.error("Assertion failed",...args);
       }
    }
    };
  return userFunction(event, ctx);
}
module.exports = wrapped;
`,
      `${functionId}.js`
    );
    if (!userFunction || typeof userFunction !== "function") {
      throw new Error("Function not found. Please export default function.");
    }
    log.atInfo().log(`[${functionId}] udf compile time ${new Date().getTime() - startMs}ms`);
    return {
      userFunction,
      close: () => {},
    };
  } catch (e) {
    return {
      userFunction: () => {
        throw new Error(`Cannot compile function: ${e}`);
      },
      close: () => {},
    };
  }
};

export type UDFTestRequest = {
  functionId: string;
  functionName: string;
  code: string;
  event: AnalyticsServerEvent;
  config: any;
  store: any;
  workspaceId: string;
};

export type UDFTestResponse = {
  error?: any;
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
}: UDFTestRequest): Promise<UDFTestResponse> {
  const logs: logType[] = [];
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
    const wrapper = UDFWrapper(id, name, code);
    const result = await wrapper.userFunction(event, ctx);
    return {
      dropped: isDropResult(result),
      result: typeof result === "undefined" ? event : result,
      store: store,
      logs,
    };
  } catch (e) {
    return {
      error: `${e}`,
      result: {},
      store: store ?? {},
      logs,
    };
  }
}
