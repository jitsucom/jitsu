// noinspection ExceptionCaughtLocallyJS

const __jts_log__ = []

for (let level of ["log", "trace", "info", "warn", "error"]) {
  console[level] = (message) => __jts_log__.push({level, message: `${message}`})
}

console["dir"] = (arg) => console.log(Object.keys(arg))

const readline = require("readline")
const os = require("os")
const fetch = require("node-fetch")
const {NodeVM} = require("vm2")

const send = (data) => {
  process.stdout.write(data + "\n")
}

const reply = async (result, error) => {
  let data = {
    ok: !error,
    result: result,
    error: error ? error.toString() : null,
    stack: error && error.stack ? error.stack.toString() : null,
    log: __jts_log__,
  }

  try {
    await send(JSON.stringify(data))
  } catch (error) {
    let edata = {
      ok: false,
      error: `Failed to send reply data ${JSON.stringify(data)}: ${error}`
    }

    await send(JSON.stringify(edata))
  } finally {
    __jts_log__.length = 0
  }
}

function mockModule(moduleName, knownSymbols) {
  return new Proxy(
    {},
    {
      get: (target, prop) => {
        let known = knownSymbols[prop.toString()];
        if (known) {
          return known;
        } else {
          throw new Error(`Attempt to call ${moduleName}.${prop.toString()} which is not safe`);
        }
      },
    }
  );
}

const vms = {}

const load = async (id, executable, variables, includes) => {
  let vm = new NodeVM({
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
        fs: mockModule("fs", {}),
        os: mockModule("os", {platform: os.platform, EOL: os.EOL}),
        child_process: {},
      },
      resolve: (moduleName) => {
        throw new Error(
          `The extension calls require('${moduleName}') which is not system module. Rollup should have linked it into JS code.`
        );
      },
    },
    sandbox: {
      ...(variables ?? {}),
      queueMicrotask: queueMicrotask,
      self: {},
      process: {
        versions: process.versions,
        version: process.version,
        env: {},
      },
    },
  })

  try {
    vms[id] = await vm.run((includes ?? []).join("\n") + "\n" + executable)
  } catch (error) {
    throw vmStack(error)
  }
}

const unload = (id) => {
  delete vms[id]
}

const vm = (id) => {
  if (id in vms) {
    return vms[id]
  }

  throw new Error("init first")
}


const vmStack = (error) => {
  if (error && error.stack) {
    let stack = error.stack.split("\n").splice(1).flatMap(row => {
      let match = row.match(/^\s*at\s(.*?)\s\(vm\.js:(\d+):(\d+)\)$/)
      if (!match) {
        return []
      }

      let func = match[1]
      if (func === "module.exports") {
        func = "main"
      }

      let line = parseInt(match[2])
      let lineOffset = parseInt("0")

      line -= lineOffset + 1
      if ("" !== "") {
        line -= "".split(/\r\n|\r|\n/).length
      }

      if (line < 0) {
        return []
      }

      let col = parseInt(match[3])
      if (line === 1) {
        let colOffset = parseInt("0")
        col -= colOffset
      }

      return [`  at ${func} (${line}:${col})`]
    }).join("\n")

    if (stack.length > 0) {
      error.stack = stack
    }
  }

  return error
}

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
        exec = await vm(payload.session)
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
        exec = await vm(payload.session)
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

        // if (func === "validator") {
        //   vm.sandbox.fetch = fetch
        // }

        try {
          result = await (func ? exec[func](...args) : exec(...args))
        } catch (error) {
          throw vmStack(error)
        }

        break
      case "unload":
        unload(payload.session)
        break
      case "kill":
        await reply()
        process.exit(0)
        break
      default:
        throw new Error(`Unsupported command: ${req.command}`)
    }

    await reply(result)
  } catch (e) {
    await reply(null, e)
  } finally {
    // vm.sandbox.fetch = undefined
  }
})