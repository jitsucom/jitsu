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

export const chainWrapperCode = `//** @UDF_FUNCTIONS_IMPORT **//
import {DropRetryErrorName, RetryError, RetryErrorName} from "@jitsu/functions-lib";

global.RetryError = RetryError;

export function checkError(chainRes) {
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
                _jitsu_log.error.apply(undefined, [{
                    function: {
                        ..._jitsu_funcCtx.function,
                        id: error.functionId || el.functionId
                    }
                }, \`Function execution failed\`, error.name, error.message], {arguments: {copy: true}});
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
    for (const [k, v] of Object.entries(o)) {
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
    ctx
) {
    const execLog = [];
    let events = [event];
    for (let k = 0; k < chain.length; k++) {
        const f = chain[k];

        const newEvents = [];
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            let result = undefined;
            // const execLogMeta = {
            //     eventIndex: i,
            //     receivedAt: rat && rat != "Invalid Date" ? rat : new Date(),
            //     functionId: f.id,
            // };
            try {
                result = await f.f(deepCopy(event), ctx);

                if (k < chain.length - 1 && Array.isArray(result) && result.length > 1) {
                    const l = result.length;
                    result = undefined;
                    throw new Error("Got " + l + " events as result of function #" + (k + 1) + " of " + chain.length + ". Only the last function in a chain is allowed to multiply events.");
                }
                // execLog.push({
                //     ...execLogMeta,
                //     ms: Date.now() - sw,
                //     dropped: isDropResult(result),
                // });
            } catch (err) {
                if (err.name === DropRetryErrorName) {
                    result = "drop";
                }
                if (f.meta?.retryPolicy) {
                    err.retryPolicy = f.meta.retryPolicy;
                }
                execLog.push({
                    functionId: f.id,
                    error: err,
                    //event,
                    // ms: Date.now() - sw,
                    // dropped: isDropResult(result),
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

const wrappedFunctionChain = async function (event, ctx) {
    let chain = [];
    //** @UDF_FUNCTIONS_CHAIN **//
    const chainRes = await runChain(chain, event, ctx);
    checkError(chainRes);
    if (Array.isArray(chainRes.events) && chainRes.events.length === 1) {
        return chainRes.events[0];
    }
    return chainRes.events;
};

const wrappedUserFunction = (id, f, funcCtx) => {

    const log = {
        info: (...args) => {
            _jitsu_log.info.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
        error: (...args) => {
            _jitsu_log.error.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
        warn: (...args) => {
            _jitsu_log.warn.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
        debug: (...args) => {
            _jitsu_log.debug.apply(undefined, [funcCtx, ...args], {arguments: {copy: true}});
        },
    }

    const store = {
        set: async (key, value, opts) => {
            await _jitsu_store.set.apply(undefined, [key, value, opts], {
                arguments: {copy: true},
                result: {promise: true}
            });
        },
        del: async key => {
            await _jitsu_store.del.apply(undefined, [key], {
                arguments: {copy: true},
                result: {promise: true}
            });
        },
        get: async key => {
            const res = await _jitsu_store.get.apply(undefined, [key], {
                arguments: {copy: true},
                result: {promise: true}
            });
            return res ? JSON.parse(res) : undefined;
        },
        ttl: async key => {
            return await _jitsu_store.ttl.apply(undefined, [key], {
                arguments: {copy: true},
                result: {promise: true}
            });
        },
    }

    const fetch = async (url, opts, extras) => {
        let res
        if (extras) {
            res = await _jitsu_fetch.apply(undefined, [url, opts, {ctx: funcCtx, event: extras.event}], {
                arguments: {copy: true},
                result: {promise: true}
            });
        } else {
            res = await _jitsu_fetch.apply(undefined, [url, opts], {
                arguments: {copy: true},
                result: {promise: true}
            });
        }
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
    }

    return async function (event, c) {
        const debugEnabled = funcCtx.function.debugTill && funcCtx.function.debugTill > new Date();
        let ftch = fetch
        if (debugEnabled) {
            ftch = async(url, opts) => {
                return fetch(url, opts, {event});
            }
        }
        const ctx = {
            ...c,
            props: funcCtx.props,
            log,
            store,
            fetch: ftch,
        };
        return await f(event, ctx);
    }
};

export {wrappedFunctionChain};
`;
