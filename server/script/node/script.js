let __jts_log__ = []

const log = (level) => (...args) => __jts_log__.push({level: level, message: args.join(" ")})

const __jts_fetch__ = require("node-fetch")
const __jts_readline__ = require("readline")
const __jts_process__ = process

const sandbox = (name) => {
  throw new Error(`${name} is disabled in Jitsu transformations function for security reasons.`)
}

globalThis.console = {
  debug: log("debug"),
  info: log("info"),
  log: log("info"),
  warn: log("warn"),
  error: log("error"),
}

globalThis.fetch = () => {
  throw new Error(`'fetch' is enabled only for 'validator' function for security reasons.`)
}

globalThis.process = {}

const send = (data) => {
  __jts_process__.stdout.write(data + "\n")
}

const reply = async (result, error) => {
  let data = {
    ok: !error,
    result: result,
    error: error,
    log: __jts_log__,
  }

  __jts_log__ = []
  try {
    await send(JSON.stringify(data))
  } catch (error) {
    let edata = {
      ok: false,
      error: `Failed to send reply data ${JSON.stringify(data)}: ${error}`
    }

    await send(JSON.stringify(edata))
  }
}

__jts_readline__.createInterface({
  input: __jts_process__.stdin
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

  let fetch = globalThis.fetch
  let result = undefined
  try {
    globalThis.__jts_plugin__ = globalThis.__jts_plugin__ || (async () => {
      const variables = eval("{{ .Variables }}")
      for (let [key, value] of (variables ? Object.entries(variables) : [])) {
        globalThis[key] = value
      }

      eval("{{ .Includes }}")
      return eval("{{ .Executable }}")
    })()

    let plugin = undefined
    switch (req.command) {
      case "describe":
        plugin = await __jts_plugin__
        let symbols = {}
        for (let key of Object.keys(plugin)) {
          let value = plugin[key]
          let symbol = {type: typeof value}
          if (symbol.type !== "function") {
            symbol["value"] = value
          }

          symbols[key] = symbol
        }

        result = symbols
        break
      case "execute":
        plugin = await __jts_plugin__
        let args = req.payload.args
        let func = req.payload.function
        if (func === "validator") {
          globalThis.fetch = __jts_fetch__
        }

        result = await (func ? plugin[func](...args) : plugin(...args))
        break
      case "kill":
        await reply()
        __jts_process__.exit(0)
        break
      default:
        throw new Error(`Unsupported command: ${req.command}`)
    }

    await reply(result)
  } catch (e) {
    await reply(null, e.toString())
  } finally {
    globalThis.fetch = fetch
  }
})