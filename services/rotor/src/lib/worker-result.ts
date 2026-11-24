/**
 * The events a function chain returns, in the JSON form the in-process response sends them in. A worker answers with
 * postMessage, whose structured clone is not JSON: a URL arrives as `{}` and an object with a `toJSON` loses it, where the
 * in-process response sends the string. Taking the JSON form in the worker keeps the destination from receiving a
 * different value in each mode. A value JSON cannot hold (a BigInt, a cycle) throws here, as it does when the in-process
 * response is written, and the worker answers with the error.
 */
export function toJsonEvents<T>(events: T): T {
  const json = JSON.stringify(events);
  return json === undefined ? events : (JSON.parse(json) as T);
}
