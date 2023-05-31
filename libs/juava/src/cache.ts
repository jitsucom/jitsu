// A cache implementation that caches factory produced values
// It makes sure that parameters of factory method work as a part of a cache key
export function getCached<T, Args extends any[]>(globalName: string, factory: (...args: Args) => T, ...args: Args): T {
  const key = `cached_${globalName}_${args.toString()}`;
  const value = global[key];
  return typeof value !== "undefined" ? value : (global[key] = factory(...args));
}
