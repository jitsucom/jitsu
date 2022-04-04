const fetch = (...args) => import("node-fetch").then(({default: fetch}) => fetch(...args));

const transform = async (event) => {
  let _ = event
  let $ = event
  return (async () => {
// .Expression start
{{ .Expression }}
// .Expression end
  })()
}

let send = async () => {
  throw new Error("unimplemented")
}

const reply = async (result, error) => {
  let data = {
    ok: !error,
    result: result,
    error: error,
  }

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
      case "transform":
        result = await transform(req.payload)
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

// .Execute start
{{ .Execute }}
// .Execute end