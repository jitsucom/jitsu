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
