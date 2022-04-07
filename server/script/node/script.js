let log = []

const logHelper = (level) => (...args) => log.push({level: level, message: args.join(" ")})

console = {
  debug: logHelper("debug"),
  info: logHelper("info"),
  log: logHelper("info"),
  warn: logHelper("warn"),
  error: logHelper("error"),
}

const variables = eval("{{ .Variables }}")
for (let [key, value] of (variables ? Object.entries(variables) : [])) {
  globalThis[key] = value
}

eval("{{ .Includes }}")

let send = (data) => {
  process.stdout.write(data + "\n")
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

const executable = eval("{{ .Executable }}")

const handle = async (line) => {
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
    switch (req.command) {
      case "describe":
        let symbols = {}
        for (let key of Object.keys(executable)) {
          let value = executable[key]
          let symbol = {type: typeof value}
          if (symbol.type !== "function") {
            symbol["value"] = value
          }

          symbols[key] = symbol
        }

        result = symbols
        break
      case "execute":
        let args = req.payload.args
        let func = req.payload.function
        result = await (func ? executable[func](...args) : executable(...args))
        break
      case "kill":
        await reply()
        process.exit(0)
        break
      default:
        throw new Error(`Unsupported command: ${req.command}`)
    }

    await reply(result)
  } catch (error) {
    await reply(null, `Failed to execute IPC command: ${error}`)
  }
}

const opts = {
  input: process.stdin,
}

require("readline").createInterface(opts).on("line", handle)