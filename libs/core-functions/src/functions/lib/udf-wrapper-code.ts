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
