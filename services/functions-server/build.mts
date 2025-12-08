import * as esbuild from "esbuild";

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
    logLevel: "info",
  })
  .then(() => {
    console.log("\nBuild succeeded");
  });
