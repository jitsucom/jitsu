import { NodeVM } from "vm2";
import { getLog } from "juava";
import * as swc from "@swc/core";

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

export const UDFWrapper = (functionId, name, functionCode: string) => {
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
