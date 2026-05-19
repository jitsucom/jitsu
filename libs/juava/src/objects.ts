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

export function deepCopy<T>(o: T): T {
  if (typeof o !== "object") return o;
  if (!o) return o;
  if (Array.isArray(o)) {
    const newO: any[] = [];
    for (let i = 0; i < o.length; i++) {
      const v = o[i];
      newO[i] = !v || typeof v !== "object" ? v : deepCopy(v);
    }
    return newO as T;
  }
  const newO: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) {
    newO[k] = !v || typeof v !== "object" ? v : deepCopy(v);
  }
  return newO as T;
}

export function isEqual(x: any, y: any) {
  const ok = Object.keys,
    tx = typeof x,
    ty = typeof y;
  return x && y && tx === "object" && tx === ty
    ? ok(x).length === ok(y).length && ok(x).every(key => isEqual(x[key], y[key]))
    : x === y;
}
