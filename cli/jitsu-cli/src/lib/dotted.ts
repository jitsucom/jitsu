// Parse a value string from a dotted-path flag.
// Heuristic: if it parses cleanly as JSON and starts with `[`, `{`, `"`, or is a
// number/boolean/null literal, take the JSON value. Otherwise treat as a plain string.
// This lets users pass arrays/objects without quoting hell while keeping bare strings
// (`--name=foo`) working without quoting them as `"foo"`.
export function parseScalar(raw: string): unknown {
  if (raw === "") return "";
  const trimmed = raw.trim();
  const first = trimmed[0];
  const looksLikeJson =
    first === "{" ||
    first === "[" ||
    first === '"' ||
    trimmed === "true" ||
    trimmed === "false" ||
    trimmed === "null" ||
    /^-?\d/.test(trimmed);
  if (looksLikeJson) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to string
    }
  }
  return raw;
}

// Build an object by setting `path` (e.g. "credentials.password") to `value`.
// Numeric path segments (`a.0.b`) are NOT special — kept as object keys. If you
// need arrays, pass them as JSON values (e.g. --keys='["a","b"]').
export function setDottedPath(target: any, path: string, value: unknown): any {
  const parts = path.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (node[key] == null || typeof node[key] !== "object" || Array.isArray(node[key])) {
      node[key] = {};
    }
    node = node[key];
  }
  node[parts[parts.length - 1]] = value;
  return target;
}
