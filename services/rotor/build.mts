import * as esbuild from "esbuild";
import { writeFileSync, mkdirSync, statSync, readdirSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

// Native modules that need to be external and installed with their versions
const nativeDeps = {
  "isolated-vm": "6.0.0",
  "@confluentinc/kafka-javascript": "1.4.1",
  "@mongodb-js/zstd": "2.0.0",
  esbuild: "0.27.0",
  "@jitsu/functions-lib": "2.14.0-beta.19",
  mongodb: "6.12.0",
};

// pg-native is optional for pg package, mark as external but don't install
const externalModules = [...Object.keys(nativeDeps), "pg-native"];

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
    return esbuild.build({
      entryPoints: ["./src/functions-server.ts"],
      bundle: true,
      platform: "node",
      target: "node20",
      format: "cjs",
      outfile: "./dist/functions-server.js",
      sourcemap: false,
      // minify: true,
      external: externalModules,
      logLevel: "info",
    });
  })
  .then(() => {
    mkdirSync("dist", { recursive: true });
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
