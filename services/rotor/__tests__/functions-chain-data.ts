export const functions = {
  function1: {
    id: "function1",
    workspaceId: "workspace1",
    name: "Function 1",
    codeHash: "function1-hash",
    code: `export default async function(event, { log, fetch, retries, store, props: config }) {
  event.properties.first = "1st"
  event.properties.retries = retries
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  function1env: {
    id: "function1env",
    workspaceId: "workspace1",
    name: "Function 1 Env",
    codeHash: "function1env-hash",
    code: `export default async function(event, { log, fetch, retries, store, props: config }) {
  event.properties.first = process.env.FIRST || "1st"
  event.properties.retries = retries
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  function2: {
    id: "function2",
    workspaceId: "workspace1",
    name: "Function 2",
    codeHash: "function2-hash",
    code: `export default async function(event, { log, fetch, store, props: config }) {
  event.properties.second = "2nd"
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  function2error: {
    id: "function2error",
    workspaceId: "workspace1",
    name: "Function 2 Error",
    codeHash: "function2error-hash",
    code: `export default async function(event, { log, fetch, store, retries, props: config }) {
    throw new Error("Function is meant to fail")
}`,
  },
  function2retry: {
    id: "function2retry",
    workspaceId: "workspace1",
    name: "Function 2 Retry",
    codeHash: "function2retry-hash",
    code: `export const config = {
  retryPolicy: {
    attempts: 2, //retry attempts. cannot be greater than 3
    delays:  [60, 1440] // delay in minutes before each consequent attempt. cannot be greater than 1440
  }
}
export default async function(event, { log, fetch, store, retries, props: config }) {
   event.properties.second = "2nd"
   event.properties.counter = (event.properties.counter || 0) + 1
   if (retries < 1) {
     throw new RetryError("Function runs successfully only on 2nd attempt")
   }
   return event
}`,
  },
  function2dropretry: {
    id: "function2dropretry",
    workspaceId: "workspace1",
    name: "Function 2 Drop Retry",
    codeHash: "function2dropretry-hash",
    code: `export default async function(event, { log, fetch, store, retries, props: config }) {
     event.properties.second = "2nd"
     event.properties.counter = (event.properties.counter || 0) + 1
     if (retries < 1) {
       throw new RetryError("Function runs successfully only on 2nd attempt", { drop: true })
     }
     return event
}`,
  },
  function2noretry: {
    id: "function2noretry",
    workspaceId: "workspace1",
    name: "Function 2 No Retry",
    codeHash: "function2noretry-hash",
    code: `export default async function(event, { log, fetch, store, retries, props: config }) {
     event.properties.second = "2nd"
     event.properties.counter = (event.properties.counter || 0) + 1
     throw new NoRetryError("Invalid data format - permanent failure")
}`,
  },
  functionUrlField: {
    id: "functionUrlField",
    workspaceId: "workspace1",
    name: "Function Url Field",
    codeHash: "functionUrlField-hash",
    code: `export default async function(event, { log, fetch, store, props: config }) {
  // the last function of the chain assigns a value with its own JSON form (a URL): the in-process response sends it as
  // a string, and a worker must send the same
  event.properties.link = new URL("https://example.com/a?b=1")
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  functionBigInt: {
    id: "functionBigInt",
    workspaceId: "workspace1",
    name: "Function BigInt",
    codeHash: "functionBigInt-hash",
    code: `export default async function(event, { log, fetch, store, props: config }) {
  // JSON cannot hold a BigInt: writing the response fails
  event.properties.big = BigInt(10)
  return event
}`,
  },
  function3: {
    id: "function3",
    workspaceId: "workspace1",
    name: "Function 3",
    codeHash: "function3-hash",
    code: `export default async function(event, { log, fetch, store, props: config }) {
  event.properties.third = "3rd"
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  functionmulti: {
    id: "functionmulti",
    workspaceId: "workspace1",
    name: "Function Multi",
    codeHash: "functionmulti-hash",
    code: `export default async function(event, { log, fetch, store, props: config }) {
  return [{...event, n: 1}, {...event, n: 2}]
}`,
  },
  functionmultiretry: {
    id: "functionmultiretry",
    workspaceId: "workspace1",
    name: "Function Multi Retry",
    codeHash: "functionmultiretry-hash",
    code: `export default async function(event, { log, fetch, retries, store, props: config }) {
         if (retries < 1) {
       throw new RetryError("Function runs successfully only on 2nd attempt")
     }
  return [{...event, n: 1}, {...event, n: 2}]
}`,
  },
  functionNoReturn: {
    id: "functionNoReturn",
    workspaceId: "workspace1",
    name: "Function No Return",
    codeHash: "functionNoReturn-hash",
    code: `export default async function(event, { log, fetch, retries, store, props: config }) {
  log.info("This function does not return anything")
  return
}`,
  },
  functionUaGeo: {
    id: "functionUaGeo",
    workspaceId: "workspace1",
    name: "Function UA&Geo",
    codeHash: "functionUaGeo-hash",
    code: `export default async function(event, { log, fetch, retries, store, ua, geo, props: config }) {
  event.properties.ua = ua
  event.properties.geo = geo
  return event
  }`,
  },
  functionStore: {
    id: "functionStore",
    workspaceId: "workspace1",
    name: "Function Store",
    codeHash: "functionStore-hash",
    code: `export default async function(event, { store }) {
  await store.set("store-test-key", { marker: "stored-value", n: 42 })
  const val = await store.get("store-test-key")
  event.properties.storeMarker = val && val.marker
  event.properties.storeN = val && val.n
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  // reads the key the functionStore function of another connection wrote
  functionStoreOther: {
    id: "functionStoreOther",
    workspaceId: "workspace1",
    name: "Function Store Other",
    codeHash: "functionStoreOther-hash",
    code: `export default async function(event, { store }) {
  const val = await store.get("store-test-key")
  event.properties.otherSees = val ? val.marker : "nothing"
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  functionFetch: {
    id: "functionFetch",
    workspaceId: "workspace1",
    name: "Function Fetch",
    codeHash: "functionFetch-hash",
    code: `import { createHash } from "crypto"
export default async function(event, { fetch, log, props: config }) {
  // a static import of a Node built-in works in every runtime, also in a worker
  log.info("crypto-hash=" + createHash("sha256").update("abc").digest("hex").slice(0, 8))
  const res = await fetch(config.FETCH_URL, { headers: { Authorization: "Bearer secret-value", "X-Trace": "trace-1" } })
  event.properties.contentType = res.headers.get("content-type")
  // request headers given as a Headers instance have to reach the server in every runtime, also through a worker
  const echo = await fetch(config.FETCH_URL + "?echo=1", { headers: new Headers({ Authorization: "Bearer headers-object" }) })
  log.info("headers-object-auth=" + (await echo.json()).receivedAuthorization)
  // headers given as a generator of pairs can be read once: logging them must not use them up before the request is sent
  const gen = await fetch(config.FETCH_URL + "?echo=1", { headers: (function* () { yield ["Authorization", "Bearer from-generator"] })() })
  log.info("generator-auth=" + (await gen.json()).receivedAuthorization)
  // a URLSearchParams body (an OAuth token request) has to arrive as the form it is, also from a worker (postMessage)
  const form = await fetch(config.FETCH_URL + "?echo=2", { method: "POST", body: new URLSearchParams({ grant_type: "client_credentials", note: "a b" }) })
  const formJson = await form.json()
  log.info("form-body=" + formJson.received + "|" + formJson.contentType)
  // a URL object as the address: it does not survive postMessage, so a worker has to send its text
  const urlObject = new URL(config.FETCH_URL)
  urlObject.searchParams.set("echo", "1")
  const viaUrl = await fetch(urlObject, { headers: { Authorization: "Bearer via-url" } })
  log.info("url-object-auth=" + (await viaUrl.json()).receivedAuthorization)
  // a pair that is a Set (any iterable of two items) is a valid pair for fetch
  const setPair = await fetch(config.FETCH_URL + "?echo=1", { headers: (function* () { yield new Set(["Authorization", "Bearer from-set-pair"]) })() })
  log.info("set-pair-auth=" + (await setPair.json()).receivedAuthorization)
  // an address the guard refuses (FETCH_FORBID_LOCAL) has the same code in every runtime: EBLOCKED tells a refusal from a failure
  try {
    await fetch("http://10.255.255.1/refused")
  } catch (e) {
    log.info("fetch-error-codes=" + e.code + "|" + (e.cause && e.cause.code))
  }
  // a failed request (nothing listens on the port) is a TypeError in every runtime, so an instanceof check in a UDF agrees
  try {
    await fetch("http://127.0.0.1:1/closed")
  } catch (e) {
    log.info("fetch-error-type=" + (e instanceof TypeError) + "|" + e.name)
  }
  log.info("legacy-headers=" + res.headers["content-type"] + "|" + Object.keys(res.headers).includes("content-type"))
  log.info("legacy-body=" + JSON.parse(res.body).message)
  log.info("headers-in-log", res.headers)
  // a whole response in a log call: a worker clones its result with postMessage, which a Response does not survive
  log.info("response-in-log", res)
  const text = await res.text()
  const body = await res.json()
  event.properties.reread = JSON.parse(text).message
  event.properties.bytes = (await res.arrayBuffer()).byteLength > 0
  event.properties.fetched = body.message
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  // an initializer that throws something without a message: it must not stop the other connections of the workspace
  functionThrowsNull: {
    id: "functionThrowsNull",
    workspaceId: "workspace1",
    name: "Function Throws Null",
    codeHash: "functionThrowsNull-hash",
    code: `throw null
export default async function(event) {
  return event
}`,
  },
  // an uncaught exception in a timer callback ends the worker that runs it
  functionTimerThrow: {
    id: "functionTimerThrow",
    workspaceId: "workspace1",
    name: "Function Timer Throw",
    codeHash: "functionTimerThrow-hash",
    code: `export default async function(event) {
  setTimeout(() => { throw new Error("timer boom") }, 10)
  await new Promise(resolve => setTimeout(resolve, 1500))
  return event
}`,
  },
  functionWarehouseReal: {
    id: "functionWarehouseReal",
    workspaceId: "workspace1",
    name: "Function Warehouse Real",
    codeHash: "functionWarehouseReal-hash",
    code: `export default async function(event, { getWarehouse }) {
  try {
    const rows = await getWarehouse("clickhouseWarehouse").query("SELECT 1 AS value, 'hello' AS label")
    event.properties.warehouseRow = rows[0]
  } catch (e) {
    event.properties.warehouseError = e.message
  }
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
};

export const connections = {
  worker_crash: {
    id: "worker_crash",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [{ functionId: "udf.functionTimerThrow" }],
    },
    credentials: { url: "http://localhost:3089/worker_crash", method: "POST", headers: [] },
  },
  // same chain as "simple", in the same workspace as worker_crash: it is served by the same worker
  worker_after_crash: {
    id: "worker_after_crash",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [{ functionId: "udf.function1" }, { functionId: "udf.function2" }, { functionId: "udf.function3" }],
    },
    credentials: { url: "http://localhost:3089/worker_after_crash", method: "POST", headers: [] },
  },
  simple: {
    id: "simple",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.function2",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/simple",
      method: "POST",
      headers: [],
    },
  },
  env: {
    id: "env",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1env",
        },
        {
          functionId: "udf.function2",
        },
        {
          functionId: "udf.function3",
        },
      ],
      functionsEnv: {
        FIRST: "1st-from-env",
      },
    },
    credentials: {
      url: "http://localhost:3089/env",
      method: "POST",
      headers: [],
    },
  },
  noreturn: {
    id: "noreturn",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.functionNoReturn",
        },
        {
          functionId: "udf.function2",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/noreturn",
      method: "POST",
      headers: [],
    },
  },
  error: {
    id: "error",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.function2error",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/error",
      method: "POST",
      headers: [],
    },
  },
  retry: {
    id: "retry",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.function2retry",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/retry",
      method: "POST",
      headers: [],
    },
  },
  drop_retry: {
    id: "drop_retry",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.function2dropretry",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/drop_retry",
      method: "POST",
      headers: [],
    },
  },
  no_retry: {
    id: "no_retry",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.function2noretry",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/no_retry",
      method: "POST",
      headers: [],
    },
  },
  dst_retry: {
    id: "dst_retry",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.function2",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/dst_retry",
      method: "POST",
      headers: [],
    },
  },
  multi: {
    id: "multi",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.function2",
        },
        {
          functionId: "udf.functionmulti",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/multi",
      method: "POST",
      headers: [],
    },
  },
  multi_middle: {
    id: "multi_middle",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.functionmulti",
        },
        {
          functionId: "udf.function2",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/multi_middle",
      method: "POST",
      headers: [],
    },
  },
  multi_retry: {
    id: "multi_retry",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.function2",
        },
        {
          functionId: "udf.functionmultiretry",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/multi_retry",
      method: "POST",
      headers: [],
    },
  },
  ua_geo: {
    id: "ua_geo",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.functionUaGeo",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/ua_geo",
      method: "POST",
      headers: [],
    },
  },
  store: {
    id: "store",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.functionStore",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/store",
      method: "POST",
      headers: [],
    },
  },
  // writes the key that store_other reads, so that test does not depend on any other one having run
  store_seed: {
    id: "store_seed",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.functionStore",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/store_seed",
      method: "POST",
      headers: [],
    },
  },
  store_other: {
    id: "store_other",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.functionStoreOther",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/store_other",
      method: "POST",
      headers: [],
    },
  },
  fetch: {
    id: "fetch",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.functionFetch",
        },
        {
          functionId: "udf.function3",
        },
      ],
      functionsEnv: {
        FETCH_URL: "http://localhost:3089/fetch-source",
      },
    },
    credentials: {
      url: "http://localhost:3089/fetch",
      method: "POST",
      headers: [],
    },
  },
  warehouse_real: {
    id: "warehouse_real",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.functionWarehouseReal",
        },
        {
          functionId: "udf.function3",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/warehouse_real",
      method: "POST",
      headers: [],
    },
  },
  url_field: {
    id: "url_field",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.function3",
        },
        {
          functionId: "udf.functionUrlField",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/url_field",
      method: "POST",
      headers: [],
    },
  },
  unserializable_event: {
    id: "unserializable_event",
    workspaceId: "workspace1",
    updatedAt: new Date(),
    destinationId: "destination1",
    streamId: "stream1",
    usesBulker: false,
    type: "webhook",
    options: {
      functions: [
        {
          functionId: "udf.function1",
        },
        {
          functionId: "udf.functionBigInt",
        },
      ],
    },
    credentials: {
      url: "http://localhost:3089/unserializable_event",
      method: "POST",
      headers: [],
    },
  },
};
