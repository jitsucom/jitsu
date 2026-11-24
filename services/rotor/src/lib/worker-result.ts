/**
 * The events a function chain returns, in the JSON form the in-process response sends them in. A worker answers with
 * postMessage, whose structured clone is not JSON: a URL arrives as `{}` and an object with a `toJSON` loses it, where the
 * in-process response sends the string. Taking the JSON form in the worker keeps the destination from receiving a
 * different value in each mode.
 *
 * Events that JSON cannot hold (a BigInt, a cycle, a `toJSON` that throws) come back as an error, which the worker sends
 * explicitly. A clone would carry some of them on, and strip the cause of others (the class of an object with a throwing
 * `toJSON`), so that the main process delivers what the in-process response refuses to write.
 */
export type JsonEvents<T> = { events: T } | { error: { message: string; name: string } };

export function jsonEventsOf<T>(events: T): JsonEvents<T> {
  try {
    const json = JSON.stringify(events);
    return { events: json === undefined ? events : (JSON.parse(json) as T) };
  } catch (e: any) {
    return { error: { message: String(e?.message ?? e), name: String(e?.name ?? "Error") } };
  }
}
