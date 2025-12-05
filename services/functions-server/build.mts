import * as esbuild from "esbuild";

// Native modules from @jitsu/core-functions that we don't need
// Mark as external to exclude from bundle
const externalModules = [
  "isolated-vm",
  "@mongodb-js/zstd",
  "mongodb",
  "@confluentinc/kafka-javascript",
];

await esbuild.build({
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
});

console.log("\nBuild complete!");
