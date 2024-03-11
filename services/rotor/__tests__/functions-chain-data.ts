export const functions = {
  function1: {
    id: "function1",
    workspaceId: "workspace1",
    name: "Function 1",
    code: `export default async function(event, { log, fetch, retries, store, props: config }) {
  event.properties.first = "1st"
  event.properties.retries = retries
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  function2: {
    id: "function2",
    workspaceId: "workspace1",
    name: "Function 2",
    code: `export default async function(event, { log, fetch, store, props: config }) {
  event.properties.second = "2nd"
  event.properties.counter = (event.properties.counter || 0) + 1
  return event
}`,
  },
  function2error: {
    id: "function2error",
    workspaceId: "workspace1",
    name: "Function 2",
    code: `export default async function(event, { log, fetch, store, retries, props: config }) {
    throw new Error("Function is not meant to run")
}`,
  },
  function2retry: {
    id: "function2retry",
    workspaceId: "workspace1",
    name: "Function 2",
    code: `export default async function(event, { log, fetch, store, retries, props: config }) {
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
    name: "Function 2",
    code: `export default async function(event, { log, fetch, store, retries, props: config }) {
     event.properties.second = "2nd"
     event.properties.counter = (event.properties.counter || 0) + 1
     if (retries < 1) {
       throw new RetryError("Function runs successfully only on 2nd attempt", { drop: true })
     } 
     return event
}`,
  },
  function3: {
    id: "function3",
    workspaceId: "workspace1",
    name: "Function 3",
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
    code: `export default async function(event, { log, fetch, store, props: config }) {
  return [{...event, n: 1}, {...event, n: 2}]
}`,
  },
  functionmultiretry: {
    id: "functionmultiretry",
    workspaceId: "workspace1",
    name: "Function Multi Retry",
    code: `export default async function(event, { log, fetch, retries, store, props: config }) {
         if (retries < 1) {
       throw new RetryError("Function runs successfully only on 2nd attempt")
     } 
  return [{...event, n: 1}, {...event, n: 2}]
}`,
  },
};

export const connections = {
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
};
