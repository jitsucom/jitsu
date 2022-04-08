let log = []

const logHelper = (level) => (...args) => log.push({level: level, message: args.join(" ")})

globalThis.console = {
  debug: logHelper("debug"),
  info: logHelper("info"),
  log: logHelper("info"),
  warn: logHelper("warn"),
  error: logHelper("error"),
}

const _fetch = require("node-fetch")
const _readline = require("readline")
const _process = process

globalThis.fetch = () => {
  throw new Error(`'fetch' is enabled only for 'validator' function for security reasons.`)
}

globalThis.process = {}
require("module").prototype.require = () => {
  throw new Error(`'require' is disabled in Jitsu transformations for security reasons.`)
}

const send = (data) => {
  _process.stdout.write(data + "\n")
}

const reply = async (result, error) => {
  let data = {
    ok: !error,
    result: result,
    error: error,
    log: log,
  }

  log = []
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

_readline.createInterface({
  input: _process.stdin
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
    globalThis._plugin = globalThis._plugin || (async () => {
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
        plugin = await _plugin
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
        plugin = await _plugin
        let args = req.payload.args
        let func = req.payload.function
        if (func === "validator") {
          globalThis.fetch = _fetch
        }

        result = await (func ? plugin[func](...args) : plugin(...args))
        break
      case "kill":
        await reply()
        _process.exit(0)
        break
      default:
        throw new Error(`Unsupported command: ${req.command}`)
    }

    await reply(result)
  } catch (e) {
    if (e instanceof SyntaxError) {
      await reply(null, e.toString())
    } else {
      await reply(null, `Failed to execute IPC command: ${e}`)
    }
  } finally {
    globalThis.fetch = fetch
  }
})