export function deepMerge(target: any, source: any) {
  if (typeof source !== "object" || source === null) {
    return source;
  }
  if (typeof target !== "object" || target === null) {
    return source;
  }
  return Object.entries(source).reduce((acc, [key, value]) => {
    acc[key] = deepMerge(target[key], value);
    return acc;
  }, target);
}

export function isEqual(x: any, y: any) {
  const ok = Object.keys,
    tx = typeof x,
    ty = typeof y;
  return x && y && tx === "object" && tx === ty
    ? ok(x).length === ok(y).length && ok(x).every(key => isEqual(x[key], y[key]))
    : x === y;
}
