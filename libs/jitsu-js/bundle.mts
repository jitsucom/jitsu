import * as esbuild from "esbuild";
import { execSync } from "child_process";
import { mkdirSync } from "fs";

// Ensure directories exist
mkdirSync("./dist/web", { recursive: true });

// Common external packages for library builds
const libraryExternals = ["@jitsu/protocols"];

// Build configurations
const builds: esbuild.BuildOptions[] = [
  // ESM with externals
  {
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "neutral",
    mainFields: ["module", "main"],
    target: "es2015",
    format: "esm",
    outfile: "./dist/jitsu.es.js",
    external: libraryExternals,
    sourcemap: false,
  },
  // CJS with externals
  {
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "node",
    target: "es2015",
    format: "cjs",
    outfile: "./dist/jitsu.cjs.js",
    external: libraryExternals,
    sourcemap: false,
  },
  // ESM without externals (bundles everything except peer deps)
  {
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "neutral",
    mainFields: ["module", "main"],
    target: "es2015",
    format: "esm",
    outfile: "./dist/jitsu-no-ext.es.js",
    external: libraryExternals, // Keep peer deps external
    sourcemap: false,
  },
  // CJS without externals (bundles everything except peer deps)
  {
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "node",
    target: "es2015",
    format: "cjs",
    outfile: "./dist/jitsu-no-ext.cjs.js",
    external: libraryExternals, // Keep peer deps external
    sourcemap: false,
  },
  // Browser IIFE bundle (minified)
  // Note: No globalName because browser.ts manages window assignment itself via window[namespace] = jitsu
  {
    entryPoints: ["./src/browser.ts"],
    bundle: true,
    platform: "browser",
    target: "es2015",
    format: "iife",
    outfile: "./dist/web/p.js.txt",
    minify: false,
    sourcemap: false,
  },
];

// Run all builds
console.log("Building with esbuild...");
const promises = builds.map(config =>
  esbuild.build({
    ...config,
    logLevel: "info",
  })
);

Promise.all(promises).then(() => {
  console.log("\nBuild complete!");
  console.log("Generated:");
  console.log("  - dist/jitsu.es.js (ESM with externals)");
  console.log("  - dist/jitsu.cjs.js (CJS with externals)");
  console.log("  - dist/jitsu-no-ext.es.js (ESM bundled)");
  console.log("  - dist/jitsu-no-ext.cjs.js (CJS bundled)");
  console.log("  - dist/web/p.js.txt (Browser IIFE)");
  console.log("  - dist/*.d.ts (TypeScript declarations)");
});
