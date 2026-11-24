/**
 * The events a function chain returns, in the JSON form the in-process response sends them in. A worker answers with
 * postMessage, whose structured clone is not JSON: a URL arrives as `{}` and an object with a `toJSON` loses it, where the
 * in-process response sends the string. Taking the JSON form in the worker keeps the destination from receiving a
 * different value in each mode.
 *
 * Events that JSON cannot hold (a BigInt, a cycle) are returned as they are. The clone carries them to the main process,
 * where writing the response fails, as it does in process: the whole call answers HTTP 500, which rotor retries. Failing
 * here would turn it into an error entry of an HTTP 200 answer, and the ingest drops the event without a retry.
 */
export function toJsonEvents<T>(events: T): T {
  let json: string | undefined;
  try {
    json = JSON.stringify(events);
  } catch {
    return events;
  }
  return json === undefined ? events : (JSON.parse(json) as T);
}
