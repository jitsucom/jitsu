export function deepMerge(target: any, source: any) {
  if (typeof source !== "object" || source === null || Array.isArray(source) || source instanceof Date) {
    return source;
  }
  if (typeof target !== "object" || target === null || Array.isArray(target) || target instanceof Date) {
    return source;
  }
  return Object.entries(source).reduce((acc, [key, value]) => {
    acc[key] = deepMerge(target[key], value);
    return acc;
  }, target);
}

// ponytail: structuredClone is native; unlike the old hand-rolled copy it throws on
// functions in the tree — callers pass JSON-safe data only
export const deepCopy = <T>(o: T): T => structuredClone(o);

export function isEqual(x: any, y: any) {
  const ok = Object.keys,
    tx = typeof x,
    ty = typeof y;
  return x && y && tx === "object" && tx === ty
    ? ok(x).length === ok(y).length && ok(x).every(key => isEqual(x[key], y[key]))
    : x === y;
}
