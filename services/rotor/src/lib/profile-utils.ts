// Shared profile builder utilities — used by both pb-server-runtime.ts (in-process)
// and profile-worker.ts (Deno Web Worker). No Node.js or esbuild dependencies.

// Build an iterable from events array — UDF uses `for (const event of events)` syntax.
export function buildEventsIterable(events: any[]) {
  let eventIndex = 0;
  return {
    [Symbol.iterator]() {
      return {
        next() {
          if (eventIndex < events.length) {
            return { done: false as const, value: events[eventIndex++] };
          }
          return { done: true as const, value: undefined };
        },
      };
    },
    get length(): never {
      throw new Error(
        "The 'events' object doesn't have the `length` property, however you can iterate through it with `for (const item of events)` syntax"
      );
    },
    filter(): never {
      throw new Error(
        "The 'events' object doesn't have the `filter` method, however you can iterate through it with `for (const item of events)` syntax"
      );
    },
    map(): never {
      throw new Error(
        "The 'events' object doesn't have the `map` method, however you can iterate through it with `for (const item of events)` syntax"
      );
    },
    find(): never {
      throw new Error(
        "The 'events' object doesn't have the `find` method, however you can iterate through it with `for (const item of events)` syntax"
      );
    },
    some(): never {
      throw new Error(
        "The 'events' object doesn't have the `some` method, however you can iterate through it with `for (const item of events)` syntax"
      );
    },
    reduce(): never {
      throw new Error(
        "The 'events' object doesn't have the `reduce` method, however you can iterate through it with `for (const item of events)` syntax"
      );
    },
    sort(): never {
      throw new Error(
        "The 'events' object doesn't have the `sort` method, however you can iterate through it with `for (const item of events)` syntax"
      );
    },
  };
}
