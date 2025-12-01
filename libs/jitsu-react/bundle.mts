import * as esbuild from "esbuild";
import { execSync } from "child_process";


// External dependencies that shouldn't be bundled
const external = [
  "@jitsu/js",
  "react",
  "react-dom",
  "react-router-dom",
  "@types/react"
];

// Build configurations
const builds = [
  // ESM (modern)
  {
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "neutral",
    target: "es2020",
    format: "esm",
    outfile: "./dist/index.modern.js",
    external,
    sourcemap: true,
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    banner: {
      js: '"use client";'
    }
  },
  // CJS
  {
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "node",
    target: "es2020",
    format: "cjs",
    outfile: "./dist/index.js",
    external,
    sourcemap: true,
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    banner: {
      js: '"use client";'
    }
  },
];

// Run all builds
console.log("Building with esbuild...");
for (const config of builds) {
  await esbuild.build({
    ...config,
    logLevel: "info",
  });
}

console.log("\nBuild complete!");
console.log("Generated:");
console.log("  - dist/index.modern.js (ESM)");
console.log("  - dist/index.js (CJS)");
console.log("  - dist/index.d.ts (TypeScript declarations)");