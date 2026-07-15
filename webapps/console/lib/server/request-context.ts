import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped context propagated to every log line emitted while handling a
 * request. Primarily carries `request_id` (the inbound nginx `X-Request-ID`) so
 * an edge 5xx in the ingress access log can be joined to the exact app-side
 * error/stack in Datadog via `@request_id`.
 *
 * This lives in the console (not juava) because `async_hooks` is Node-only and
 * juava is also bundled for the browser. juava exposes `setLogContextProvider`
 * and calls back into `getRequestContext` for JSON log lines.
 */
export type RequestContext = {
  request_id?: string;
  [key: string]: any;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with the given context bound to the async execution. Merges with any
 * parent context so nested `runWithRequestContext` calls don't drop fields.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  const parent = storage.getStore();
  // Freeze the stored context so a stray `getRequestContext().x = …` can't alter
  // it mid-request. Fields are primitives (request_id), so a shallow freeze is
  // enough; extend a scope via a nested runWithRequestContext, not by mutation.
  return storage.run(Object.freeze({ ...parent, ...context }), fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
