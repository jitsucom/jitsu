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
