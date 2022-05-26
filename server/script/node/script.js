// noinspection ExceptionCaughtLocallyJS

const __jts_log__ = []

for (let level of ["trace", "info", "warn", "error"]) {
  console[level] = (...args) => {
    let message = (args ?? []).map(arg => {
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg, null, 2)
        } catch (e) {
          // convert to string
        }
      }

      return arg + ""
    }).join(" ")


    __jts_log__.push({level, message})
  }
}

console["log"] = console.info
console["dir"] = (arg) => console.log(Object.keys(arg))

const readline = require("readline")
const fetch = require("node-fetch")
const {NodeVM} = require("vm2")
const fs = require("fs")
const path = require("path")

const send = (data) => {
  process.stdout.write("\nJ:" + data + "\n")
}

const reply = async (result, error) => {
  let data = {
    type: "_JITSU_SCRIPT_RESULT",
    ok: !error,
    result: result,
    error: !!error ? error.toString() : null,
    stack: !!error && !!error.stack ? error.stack.toString() : null,
    log: __jts_log__,
  }

  try {
    await send(JSON.stringify(data))
  } catch (error) {
    let edata = {
      type: "_JITSU_SCRIPT_RESULT",
      ok: false,
      error: `Failed to send reply data ${JSON.stringify(data)}: ${error}`
    }

    await send(JSON.stringify(edata))
  } finally {
    __jts_log__.length = 0
  }
}

//
// Sandboxing
//

const os = require("os")

function mockModule(moduleName, knownSymbols) {
  return new Proxy(
    {},
    {
      set(target, prop, value, receiver) {
        throw new Error(`Called ${moduleName}.${prop.toString()} with ${value} & ${receiver}`)
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
  return members.reduce((obj, key) => ({...obj, [key]: throwOnCall(module, key)}), {});
}

function throwOnCall(module, prop) {
  return (...args) => {
    throw new Error(`Call to ${module}.${prop} is not allowed. Call arguments: ${[...args].join(", ")}`);
  };
}

const processOverloads = {
  env: {},
  versions: process.versions,
  version: process.version,
  stderr: process.stderr,
  stdout: process.stdout,
  emitWarning: process.emitWarning,
};

const vms = {}

const load = async (id, executable, variables, includes) => {
  let vm = new NodeVM({
    sandbox: {
      queueMicrotask: queueMicrotask,
      self: {},
      process: processOverloads,
      ...(variables ?? {}),
    },
    require: {
      context: "sandbox",
      external: false,
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
        "console",
      ],
      root: "./",

      mock: {
        fs: mockModule("fs", {...throwOnMethods("fs", ["readFile", "realpath", "lstat"])}),
        os: mockModule("os", {platform: os.platform, EOL: os.EOL}),
        process: mockModule("process", processOverloads),
        child_process: {},
      },
      resolve: moduleName => {
        throw new Error(
          `The extension calls require('${moduleName}') which is not system module. Rollup should have linked it into JS code.`
        );
      },
    },
  })

  let file = path.join(process.cwd(), `${id}.js`)
  fs.writeFileSync(file, (includes ?? []).join("\n") + "\n" + executable)

  vms[id] = {
    file,
    value: await vm.runFile(file),
    sandbox: vm.sandbox,
  }
}

const unload = (id) => {
  if (id in vms) {
    fs.rmSync(vms.file)
  }

  delete vms[id]
}

const vm = (id) => {
  if (id in vms) {
    return vms[id]
  }

  throw "__load_required__"
}

//
// Transport
//

readline.createInterface({
  input: process.stdin
}).on("line", async (line) => {
  let req = {}
  try {
    req = JSON.parse(line)
  } catch (error) {
    await reply(null, `Failed to parse incoming IPC request [${line}]: ${error}`)
    return
  }

  if (!req.command) {
    await reply(null, `Command is not specified`)
    return
  }

  let payload = req.payload
  let result = undefined
  try {
    let exec = undefined
    switch (req.command) {
      case "load":
        await load(payload.session, payload.executable, payload.variables, payload.includes)
        break
      case "describe":
        exec = await vm(payload.session).value
        let symbols = {}
        for (let key of Object.keys(exec)) {
          let value = exec[key]
          let symbol = {type: typeof value}
          if (symbol.type !== "function") {
            symbol["value"] = value
          }

          symbols[key] = symbol
        }

        result = symbols
        break
      case "execute":
        let entry = vm(payload.session)
        exec = await entry.value
        let args = payload.args
        let func = payload.function
        if (!func || func === "") {
          if (typeof exec !== "function") {
            throw new Error(`this executable provides named exports, but an anonymous one was given for execution`)
          }
        } else {
          if (typeof exec === "function") {
            throw new Error(`this executable provides an anonymous function export, but a named one (${func}) was given for execution`)
          } else if (!(func in exec)) {
            throw new Error(`function ${func} does not exist`)
          }
        }

        if (func === "validator") {
          entry.sandbox.fetch = fetch
        }

        try {
          result = await (func ? exec[func](...args) : exec(...args))
        } finally {
          entry.sandbox.fetch = undefined
        }

        break
      case "unload":
        unload(payload.session)
        break
      default:
        throw new Error(`Unsupported command: ${req.command}`)
    }

    await reply(result)
  } catch (e) {
    await reply(null, e)
  }
})