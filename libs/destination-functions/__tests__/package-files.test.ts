import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The published package ships only the files listed in package.json "files". The Reverse ETL runtime registry imports
// each provider, so a provider directory missing from the list breaks every consumer of the published package even
// though everything works inside the monorepo (JITSU-242: the webhook provider was missing).
const root = join(__dirname, "..");
const files: string[] = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).files;

const included = (path: string) =>
  files.some(pattern => (pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : path === pattern));

function walk(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap(name => {
    const path = `${dir}/${name}`;
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });
}

function shippedSources(): string[] {
  return files.flatMap(pattern => {
    if (pattern.endsWith("/**")) return walk(pattern.slice(0, -3)).filter(path => /\.tsx?$/.test(path));
    return /\.tsx?$/.test(pattern) ? [pattern] : [];
  });
}

function relativeImports(path: string): string[] {
  const source = readFileSync(join(root, path), "utf8");
  const found = [...source.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map(match => match[1]);
  return found.map(spec => {
    const base = relative(root, join(root, dirname(path), spec));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
      if (existsSync(join(root, candidate)) && statSync(join(root, candidate)).isFile()) return candidate;
    }
    return base;
  });
}

describe("published files", () => {
  it("every relative import of a published file is published too", () => {
    const missing = shippedSources().flatMap(path =>
      relativeImports(path)
        .filter(target => !included(target))
        .map(target => `${path} imports ${target}`)
    );
    expect(missing).toEqual([]);
  });

  it("the check sees the webhook provider (guards the test itself)", () => {
    expect(shippedSources().some(path => path.startsWith("src/reverse-etl/"))).toBe(true);
    expect(relativeImports("src/reverse-etl/runtime.ts").some(target => target.includes("webhook"))).toBe(true);
  });
});
