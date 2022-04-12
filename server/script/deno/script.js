// noinspection ExceptionCaughtLocallyJS
import { readLines } from "https://deno.land/std/io/buffer.ts"

const __jts_log__ = []
const __jts_fetch__ = fetch
globalThis.fetch = undefined

const send = (data) => {
  Deno.stdout.write(new TextEncoder().encode(data + "\n"))
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

for (let level of ["dir", "log", "trace", "info", "warn", "error"]) {
  console[level] = (message) => __jts_log__.push({level, message: `${message}`})
}

(async () => {
  for await (const line of readLines(Deno.stdin)) {
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
        for (let [k, v] of Object.entries({{ .Variables }})) {
          globalThis[k] = v
        }

        eval("{{ .Includes }}")
        return eval("{{ .Executable }}")
      })()

      let exec = undefined
      switch (req.command) {
        case "describe":
          exec = await __jts_exec__
          let symbols = {}
          if (typeof exec === "object") {
            for (let key of Object.keys(exec)) {
              let value = exec[key]
              let symbol = {type: typeof value}
              if (symbol.type !== "function") {
                symbol["value"] = value
              }

              symbols[key] = symbol
            }
          }

          result = symbols
          break
        case "execute":
          exec = await __jts_exec__
          let args = req.payload.args
          let func = req.payload.function
          if (func === "validator") {
            globalThis.fetch = __jts_fetch__
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
          Deno.exit(0)
          break
        default:
          throw new Error(`Unsupported command: ${req.command}`)
      }

      await reply(result)
    } catch (e) {
      await reply(null, `${e}`)
    } finally {
      globalThis.fetch = undefined
    }
  }
})()