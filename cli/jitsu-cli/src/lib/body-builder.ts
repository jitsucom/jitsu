import * as fs from "fs";
import yaml from "js-yaml";
import { parseScalar, setDottedPath } from "./dotted";

export type BodySources = {
  // Path to a yaml/json file. `-` means stdin.
  file?: string;
  // Inline JSON string (full body or partial).
  json?: string;
  // Already-parsed dotted-path fields, e.g. { "credentials.password": "secret" }.
  fields?: Record<string, string>;
};

// Builds a single request body by merging (deep) sources in this order:
//   1. -f / --file
//   2. --json
//   3. dotted-path flags
// Later sources override earlier ones at the leaf level. Arrays are replaced, not concatenated.
// Returns undefined if no source is provided.
export function buildBody(sources: BodySources): unknown {
  const layers: any[] = [];
  if (sources.file) layers.push(loadFile(sources.file));
  if (sources.json) layers.push(parseInlineJson(sources.json));
  if (sources.fields && Object.keys(sources.fields).length > 0) {
    const obj: any = {};
    for (const [path, raw] of Object.entries(sources.fields)) {
      setDottedPath(obj, path, parseScalar(raw));
    }
    layers.push(obj);
  }
  if (layers.length === 0) return undefined;
  return layers.reduce((acc, layer) => deepMerge(acc, layer), {});
}

function loadFile(path: string): unknown {
  const text = path === "-" ? fs.readFileSync(0, "utf-8") : fs.readFileSync(path, "utf-8");
  // js-yaml's safeLoad handles JSON too (JSON is valid YAML). But trim first — empty file is null.
  const parsed = yaml.load(text);
  if (parsed === null || parsed === undefined) {
    throw new Error(`File ${path} parsed as empty`);
  }
  return parsed;
}

function parseInlineJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`--json value is not valid JSON: ${(e as Error).message}`);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge(target: any, source: any): any {
  if (!isPlainObject(target) || !isPlainObject(source)) return source;
  const out: any = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
