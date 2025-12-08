import * as esbuild from "esbuild";
import { mkdirSync } from "fs";

// Ensure dist directory exists
mkdirSync("./dist", { recursive: true });

// External modules that should not be bundled
// These are either native modules or need to be loaded at runtime
const externalModules = [
  // Native/binary modules
  "figlet", // ASCII art library with data files
  "fsevents", // macOS-only native file system events
  "esbuild", // esbuild has native binaries, used at runtime to build user functions

  // Large runtime dependencies
  "typescript", // TypeScript compiler (large, used at runtime)
  "jest-cli", // Jest test runner
];

// Bundle the CLI
esbuild
  .build({
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: "./dist/main.js",
    sourcemap: true,
    minify: false,
    external: externalModules,
    logLevel: "info",
    loader: {
      ".json": "json",
    },
  })
  .then(() => {
    console.log("\nBuild complete!");
  });
