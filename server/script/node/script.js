// noinspection ExceptionCaughtLocallyJS

const __jts_log__ = []
const readline = require("readline")
const fetch = require("node-fetch")
const {NodeVM} = require("vm2")

const send = (data) => {
  process.stdout.write(data + "\n")
}

const reply = async (result, error) => {
  let data = {
    ok: !error,
    result: result,
    error: error,
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

const vm = new NodeVM({
  console: "redirect",
  require: {
    external: true,
    builtin: ["stream", "http", "url", "punycode", "https", "zlib", "events", "net", "tls", "buffer", "string_decoder", "assert", "util", "crypto"],
  },
  sandbox: {{ .Variables }}
})

for (let level of ["dir", "log", "trace", "info", "warn", "error"]) {
  vm.on(`console.${level}`, (message) => __jts_log__.push({level, message: `${message}`}))
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
    globalThis.__jts_exec__ = globalThis.__jts_exec__ || (async () => vm.run("{{ .Includes }}\n{{ .Executable }}"))()

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

        result = await (func ? exec[func](...args) : exec(...args))
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
    await reply(null, !!e ? e.toString() : "error is null")
  } finally {
    vm.sandbox.fetch = undefined
  }
})