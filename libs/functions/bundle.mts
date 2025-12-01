import * as esbuild from "esbuild";
import { execSync } from "child_process";

// Generate TypeScript declarations first
console.log("Generating TypeScript declarations...");
execSync("tsc -p .", { stdio: "inherit" });

// Build ESM version
await esbuild.build({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  platform: "node",
  target: "es2020",
  format: "esm",
  outfile: "./dist/index.es.js",
  sourcemap: true,
  minify: false,
  external: [], // Add any runtime dependencies here
  logLevel: "info",
});

// Build CJS version
await esbuild.build({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  platform: "node",
  target: "es2020",
  format: "cjs",
  outfile: "./dist/index.cjs.js",
  sourcemap: true,
  minify: false,
  external: [], // Add any runtime dependencies here
  logLevel: "info",
});

console.log("\nBuild complete!");
console.log("Generated:");
console.log("  - dist/index.es.js (ESM)");
console.log("  - dist/index.cjs.js (CJS)");
console.log("  - dist/index.d.ts (TypeScript declarations)");