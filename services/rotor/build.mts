import * as esbuild from "esbuild";
import { writeFileSync, mkdirSync, rmSync, statSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

// Native modules that need to be external and installed with their versions
const nativeDeps = {
  "isolated-vm": "6.0.0",
  "@confluentinc/kafka-javascript": "1.4.1",
  "@mongodb-js/zstd": "2.0.0",
  esbuild: "0.27.0",
  mongodb: "6.12.0",
  "prom-client": "15.1.3",
};

// External deps for Deno functions-server.
// Only runtime-compiled code and native binaries stay external.
// Everything else (mongodb, prom-client, workspace packages, etc.) is bundled by esbuild.
const denoExternalDeps: Record<string, string> = {
  esbuild: "0.27.0", // Native binary — used at runtime for UDF compilation
};

// MongoDB's optional peer deps — loaded via try/catch require() in deps.js.
// Must be external so esbuild doesn't try to resolve them at build time.
const mongoOptionalPeers = [
  "@mongodb-js/zstd",
  "kerberos",
  "@aws-sdk/credential-providers",
  "gcp-metadata",
  "snappy",
  "socks",
  "aws4",
  "mongodb-client-encryption",
];

const denoExternalModules = [...Object.keys(denoExternalDeps), ...mongoOptionalPeers];

// pg-native is optional for pg package, mark as external but don't install
const externalModules = [...Object.keys(nativeDeps), "pg-native"];

// Node built-in modules that must use "node:" prefix for Deno compatibility.
// esbuild's platform: "node" normally bundles these as bare require("fs") etc.,
// but Deno requires the "node:" prefix. This plugin rewrites them to external "node:*" imports.
const nodeBuiltins = [
  "assert",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "dns",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
];

function denoNodePrefixPlugin(): esbuild.Plugin {
  return {
    name: "deno-node-prefix",
    setup(build) {
      // Match bare Node built-in imports (without node: prefix)
      const filter = new RegExp(`^(${nodeBuiltins.map(m => m.replace("/", "\\/")).join("|")})$`);
      build.onResolve({ filter }, args => {
        return { path: `node:${args.path}`, external: true };
      });
      // Also pass through already-prefixed imports
      build.onResolve({ filter: /^node:/ }, args => {
        return { path: args.path, external: true };
      });
    },
  };
}

// Bundle the app
esbuild
  .build({
    entryPoints: ["./src/index.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: "./dist/main.js",
    sourcemap: false,
    minify: true,
    external: externalModules,
    logLevel: "info",
  })
  .then(() => {
    // Deno functions-server (ESM format).
    // Only native deps are externalized.
    // Everything else (workspace packages, pure JS/ESM, prom-client) is bundled by esbuild.
    // The banner polyfills require() via createRequire so that CJS packages bundled
    // into ESM (which esbuild converts to __require() calls) work under Deno.
    return esbuild.build({
      entryPoints: ["./src/functions-server.ts"],
      bundle: true,
      platform: "node",
      target: "es2022",
      format: "esm",
      outfile: "./dist/functions-server.mjs",
      sourcemap: false,
      minify: false,
      external: denoExternalModules,
      plugins: [denoNodePrefixPlugin()],
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
      },
      logLevel: "info",
    });
  })
  .then(() => {
    // Deno workspace worker (ESM – runs in Web Worker sandbox with permissions: "none")
    return esbuild.build({
      entryPoints: ["./src/lib/workspace-worker.ts"],
      bundle: true,
      platform: "node",
      target: "es2022",
      format: "esm",
      outfile: "./dist/workspace-worker.mjs",
      sourcemap: false,
      minify: false,
      external: [],
      plugins: [denoNodePrefixPlugin()],
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url); var __require = require; globalThis.require = require',
      },
      logLevel: "info",
    });
  })
  .then(() => {
    mkdirSync("dist", { recursive: true });
    // Remove old node_modules to force recompilation of native addons for current platform
    rmSync("dist/node_modules", { recursive: true, force: true });
    writeFileSync("dist/package.json", JSON.stringify({ dependencies: nativeDeps }, null, 2));

    // Install native deps
    console.log("Installing native dependencies...");
    execSync("cd dist && npm install --prod --no-package-lock", { stdio: "inherit" });

    // Show sizes
    function getDirSize(dirPath: string): number {
      let size = 0;
      try {
        const files = readdirSync(dirPath, { withFileTypes: true });
        for (const file of files) {
          const filePath = join(dirPath, file.name);
          if (file.isDirectory()) {
            size += getDirSize(filePath);
          } else {
            size += statSync(filePath).size;
          }
        }
      } catch (e) {
        // ignore errors
      }
      return size;
    }

    function formatBytes(bytes: number): string {
      if (bytes === 0) return "0 B";
      const k = 1024;
      const sizes = ["B", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
    }

    const nodeModulesSize = getDirSize("dist/node_modules");
    const distSize = getDirSize("dist");

    console.log(`\nnode_modules size: ${formatBytes(nodeModulesSize)}`);
    console.log(`dist total size: ${formatBytes(distSize)}`);
    console.log("\nBuild complete!");
  });
