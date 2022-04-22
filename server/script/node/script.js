// noinspection ExceptionCaughtLocallyJS

const __jts_log__ = []
const readline = require("readline")
const os = require("os")
const fetch = require("node-fetch")
const {NodeVM} = require("vm2")

const send = (data) => {
  process.stdout.write("\nJ:" + data + "\n")
}

const reply = async (result, error) => {
  let data = {
    type: "_JITSU_SCRIPT_RESULT",
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
      type: "_JITSU_SCRIPT_RESULT",
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

const vm = new NodeVM({
  console: "redirect",
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
      os: mockModule("os", { platform: os.platform, EOL: os.EOL }),
      child_process: {},
    },
    resolve: (moduleName) => {
      throw new Error(
        `The extension calls require('${moduleName}') which is not system module. Rollup should have linked it into JS code.`
      );
    },
  },
  sandbox: {
    ...JSON.parse("{{ .Variables }}"),
    queueMicrotask: queueMicrotask,
    self: {},
    process: {
      versions: process.versions,
      version: process.version,
      stderr: process.stderr,
      stdout: process.stdout,
      env: {},
    },
  },
})

for (let level of ["log", "trace", "info", "warn", "error"]) {
  let log = (message) => __jts_log__.push({level, message: `${message}`})
  vm.on(`console.${level}`, log)
  console[level] = log
}

const dir = (arg) => console.log(Object.keys(arg))
vm.on(`console.dir`, dir)
console["dir"] = dir

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
      let lineOffset = parseInt("{{ .LineOffset }}")

      line -= lineOffset + 1
      if ("{{ .Includes }}" !== "") {
        line -= "{{ .Includes }}".split(/\r\n|\r|\n/).length
      }

      if (line < 0) {
        return []
      }

      let col = parseInt(match[3])
      if (line === 1) {
        let colOffset = parseInt("{{ .ColOffset }}")
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

  let result = undefined
  try {
    globalThis.__jts_exec__ = globalThis.__jts_exec__ || (async () => {
      try {
        return vm.run("{{ .Includes }}\n{{ .Executable }}")
      } catch (error) {
        throw vmStack(error)
      }
    })()

    let exec = undefined
    switch (req.command) {
      case "describe":
        exec = await __jts_exec__
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
        exec = await __jts_exec__
        let args = req.payload.args
        let func = req.payload.function
        if (func === "validator") {
          vm.sandbox.fetch = fetch
        }

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

        try {
          result = await (func ? exec[func](...args) : exec(...args))
        } catch (error) {
          throw vmStack(error)
        }

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
    vm.sandbox.fetch = undefined
  }
})