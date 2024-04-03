import { DropRetryErrorName, RetryErrorName } from "@jitsu/functions-lib";

export const functionsLibCode = `const DropRetryErrorName = "Drop & RetryError";
const RetryErrorName = "RetryError";
class RetryError extends Error {
    constructor(message, options) {
        super(message);
        this.name = options?.drop ? "${DropRetryErrorName}" : "${RetryErrorName}";
    }
}

export { DropRetryErrorName, RetryError, RetryErrorName };`;

export const wrapperCode = `//JS
import * as udf from "udf";
import { RetryError } from "@jitsu/functions-lib";

const userFunction = udf.default;
const meta = udf.config || {};

global.RetryError = RetryError;

const wrappedUserFunction = async function (eventcopy, ctxcopy) {
  const c = ctxcopy.copy();
  const ctx = {
    ...c,
    store: {
      ...c.store,
      get: async key => {
        const res = await c.store.get.apply(undefined, [key], { arguments: { copy: true }, result: { promise: true } });
        return res ? JSON.parse(res) : undefined;
      },
      ttl: async key => {
        return await c.store.ttl.apply(undefined, [key], { arguments: { copy: true }, result: { promise: true } });
      },
    },
    fetch: async (url, opts) => {
      const res = await c.fetch.apply(undefined, [url, opts], { arguments: { copy: true }, result: { promise: true } });
      const r = JSON.parse(res);

      return {
        ...r,
        json: async () => {
          return JSON.parse(r.body);
        },
        text: async () => {
          return r.body;
        },
        arrayBuffer: async () => {
          throw new Error("Method 'arrayBuffer' is not implemented");
        },
        blob: async () => {
          throw new Error("Method 'blob' is not implemented");
        },
        formData: async () => {
          throw new Error("Method 'formData' is not implemented");
        },
        clone: async () => {
          throw new Error("Method 'clone' is not implemented");
        },
      };
    },
  };
  const event = eventcopy.copy();
  if (!userFunction || typeof userFunction !== "function") {
    throw new Error("Function not found. Please export default function.");
  }
  console = {
    ...console,
    log: ctx.log.info,
    error: ctx.log.error,
    warn: ctx.log.warn,
    debug: ctx.log.debug,
    info: ctx.log.info,
    assert: (asrt, ...args) => {
      if (!asrt) {
        ctx.log.error("Assertion failed", ...args);
      }
    },
  };
  return userFunction(event, ctx);
};
export { meta, wrappedUserFunction };
`;

export const chainWrapperCode = `//** @UDF_FUNCTIONS_IMPORT **//
import {DropRetryErrorName, RetryError, RetryErrorName} from "@jitsu/functions-lib";

global.RetryError = RetryError;

export function checkError(chainRes, funcCtx) {
    let errObj = undefined;
    for (const el of chainRes.execLog) {
        const error = el.error;
        if (error) {
            if (!errObj && (error.name === DropRetryErrorName || error.name === RetryErrorName)) {
                errObj = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    retryPolicy: error.retryPolicy,
                    event: chainRes.events,
                    functionId: error.functionId || el.functionId
                }
            } else {
                funcCtx.log.error.apply(undefined, [\`Function execution failed\`, error.name, error.message, {udfId: error.functionId || el.functionId}], {arguments: {copy: true}});
            }
        }
    }
    if (errObj) {
        throw new Error(JSON.stringify(errObj));
    }
}

function deepCopy(o) {
    if (typeof o !== "object") {
        return o
    }
    if (!o) {
        return o
    }

    // https://jsperf.com/deep-copy-vs-json-stringify-json-parse/25
    if (Array.isArray(o)) {
        const newO = []
        for (let i = 0; i < o.length; i += 1) {
            const v = o[i]
            newO[i] = !v || typeof v !== "object" ? v : deepCopy(v)
        }
        return newO
    }

    const newO = {}
    for (const [k,v] of Object.entries(o)) {
        newO[k] = !v || typeof v !== "object" ? v : deepCopy(v)
    }
    return newO
}

function isDropResult(result) {
    return result === "drop" || (Array.isArray(result) && result.length === 0) || result === null || result === false;
}

async function runChain(
    chain,
    event,
    funcCtx
) {
    const execLog = [];
    let events = [event];
    for (let k = 0; k < chain.length; k++) {
        const f = chain[k];

        const newEvents = [];
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            let result = undefined;
            const sw = Date.now();
            const rat = new Date(event.receivedAt);
            const execLogMeta = {
                eventIndex: i,
                receivedAt: rat && rat != "Invalid Date" ? rat : new Date(),
                functionId: f.id,
            };
            try {
                result = await f.f(deepCopy(event), funcCtx);

                if (k < chain.length - 1 && Array.isArray(result) && result.length > 1) {
                    const l = result.length;
                    result = undefined;
                    throw new Error("Got " + l + "events as result of function #" + k + 1 + " of " + chain.length + ". Only the last function in a chain is allowed to multiply events.");
                }
                execLog.push({
                    ...execLogMeta,
                    ms: Date.now() - sw,
                    dropped: isDropResult(result),
                });
            } catch (err) {
                if (err.name === DropRetryErrorName) {
                    result = "drop";
                }
                if (f.meta?.retryPolicy) {
                    err.retryPolicy = f.meta.retryPolicy;
                }
                execLog.push({
                    ...execLogMeta,
                    event,
                    error: err,
                    ms: Date.now() - sw,
                    dropped: isDropResult(result),
                });
            }
            if (!isDropResult(result)) {
                if (result) {
                    // @ts-ignore
                    newEvents.push(...(Array.isArray(result) ? result : [result]));
                } else {
                    newEvents.push(event);
                }
            }
        }
        events = newEvents;
    }
    return {events, execLog};
}

const wrappedFunctionChain = async function (eventcopy, ctxcopy) {
    const c = ctxcopy;
    let chain = [];
    //** @UDF_FUNCTIONS_CHAIN **//
    const event = eventcopy;
    const chainRes = await runChain(chain, event, c);
    checkError(chainRes, c);
    if (Array.isArray(chainRes.events) && chainRes.events.length === 1) {
        return chainRes.events[0];
    }
    return chainRes.events;
};

const wrappedUserFunction = (id, f) => async function (event, c) {
    const ctx = {
        ...c,
        log: {
            info: (...args) => {
                c.log.info.apply(undefined, [...args, {udfId: id}], {arguments: {copy: true}});
            },
            error: (...args) => {
                c.log.error.apply(undefined, [...args, {udfId: id}], {arguments: {copy: true}});
            },
            warn: (...args) => {
                c.log.warn.apply(undefined, [...args, {udfId: id}], {arguments: {copy: true}});
            },
            debug: (...args) => {
                c.log.debug.apply(undefined, [...args, {udfId: id}], {arguments: {copy: true}});
            },
        },
        store: {
            set: async (key,value,opts) => {
                await c.store.set.apply(undefined, [key, value,opts], {
                    arguments: {copy: true},
                    result: { ignore: true}
                });
            },
            del: async key => {
                await c.store.del.apply(undefined, [key], {
                    arguments: {copy: true},
                    result: {ignore: true}
                });
            },
            get: async key => {
                const res = await c.store.get.apply(undefined, [key], {
                    arguments: {copy: true},
                    result: {promise: true}
                });
                return res ? JSON.parse(res) : undefined;
            },
            ttl: async key => {
                return await c.store.ttl.apply(undefined, [key], {
                    arguments: {copy: true},
                    result: {promise: true}
                });
            },
        },
        fetch: async (url, opts) => {
            const res = await c.fetch.apply(undefined, [url, opts, {udfId: id}], {
                arguments: {copy: true},
                result: {promise: true}
            });
            const r = JSON.parse(res);

            return {
                ...r,
                json: async () => {
                    return JSON.parse(r.body);
                },
                text: async () => {
                    return r.body;
                },
                arrayBuffer: async () => {
                    throw new Error("Method 'arrayBuffer' is not implemented");
                },
                blob: async () => {
                    throw new Error("Method 'blob' is not implemented");
                },
                formData: async () => {
                    throw new Error("Method 'formData' is not implemented");
                },
                clone: async () => {
                    throw new Error("Method 'clone' is not implemented");
                },
            };
        },
    };
    console = {
        ...console,
        log: ctx.log.info,
        error: ctx.log.error,
        warn: ctx.log.warn,
        debug: ctx.log.debug,
        info: ctx.log.info,
        assert: (asrt, ...args) => {
            if (!asrt) {
                ctx.log.error("Assertion failed", ...args);
            }
        },
    };
    return f(event, ctx);
};

export {wrappedFunctionChain};
`;
