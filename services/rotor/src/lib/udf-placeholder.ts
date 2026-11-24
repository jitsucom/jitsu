import { RetryErrorName } from "@jitsu/functions-lib";

// A UDF that fails to compile or to load is replaced by a function that throws. In process that is a RetryError, so the
// event is retried (the fix may arrive with the next deploy); a worker used to throw a plain Error, which the rotor client
// only logs, and the event lost its retries. The chain tells the kinds apart by the `name` of the error.

/** The error a replaced UDF throws: the message of the failure, named like a RetryError. */
export function retryErrorOf(message: string): Error {
  return Object.assign(new Error(message), { name: RetryErrorName });
}

/** IIFE code (`var __udf = ...`) of a UDF that could not be compiled: it throws the RetryError above. */
export function compileFailureIife(message: string): string {
  return `var __udf = { default: async function() { throw Object.assign(new Error(${JSON.stringify(
    message
  )}), { name: ${JSON.stringify(RetryErrorName)} }); } };`;
}

/** Why the `functions` option of a connection cannot be read, or undefined when it can (absent counts as none). */
export function invalidFunctionsReason(options: any): string | undefined {
  const functions = options?.functions;
  if (functions === undefined || functions === null) return undefined;
  if (!Array.isArray(functions)) return "the functions option is not a list";
  if (functions.some(f => typeof f?.functionId !== "string"))
    return "an entry of the functions option has no functionId";
  return undefined;
}

/** The message of whatever a UDF threw: `throw null` or `throw undefined` have none to read. */
export function errorMessageOf(err: unknown): string {
  const message = (err as any)?.message;
  return typeof message === "string" ? message : String(err);
}
