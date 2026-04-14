import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";
import * as esbuild from "esbuild";
import * as functionLib from "@jitsu/functions-lib";

// Whitelist of packages that UDF code is allowed to import (will be bundled)
export const ALLOWED_PACKAGES = ["@jitsu/functions-lib"];

// Node.js built-in modules (marked as external - available at runtime)
export const NODE_BUILTINS = ["crypto"];

// esbuild plugin to whitelist allowed imports
export function createWhitelistPlugin(allowedPackages: string[]): esbuild.Plugin {
  return {
    name: "whitelist-imports",
    setup(build) {
      // Intercept all bare module imports (not relative/absolute paths)
      build.onResolve({ filter: /^[^./]/ }, args => {
        // Extract package name (handle scoped packages like @scope/package)
        const packageName = args.path.startsWith("@")
          ? args.path.split("/").slice(0, 2).join("/")
          : args.path.split("/")[0];

        // Allow whitelisted packages - let esbuild resolve and bundle them
        if (allowedPackages.includes(packageName)) {
          return null;
        }

        // Node built-ins - mark as external with node: prefix (required by Deno)
        if (NODE_BUILTINS.includes(packageName)) {
          return { path: `node:${args.path}`, external: true };
        }

        // Everything else - error
        return {
          errors: [
            {
              text: `Import "${packageName}" is not allowed in UDF functions. Allowed packages: ${[
                ...allowedPackages,
                ...NODE_BUILTINS,
              ].join(", ")}`,
            },
          ],
        };
      });
    },
  };
}

// Directory for compiled UDF files (for readable stack traces)
export const UDF_TEMP_DIR = path.join(os.tmpdir(), "jitsu-udf");

// Ensure UDF temp directory exists
export async function ensureUdfTempDir(): Promise<void> {
  try {
    await fsp.access(UDF_TEMP_DIR);
  } catch {
    await fsp.mkdir(UDF_TEMP_DIR, { recursive: true });
  }
}

// Sanitize function ID for use in filename
export function sanitizeFunctionId(functionId: string): string {
  return functionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// Compile UDF function from code string using esbuild.
// Returns the imported module (with .default as the function).
export async function compileUdfFunction(
  connectionId: string,
  code: string,
  functionId: string,
  env: any
): Promise<any> {
  try {
    const tempFile = await compileUdfToFile(connectionId, code, functionId, env);

    // Import from file path (gives readable stack traces)
    const module = await import(tempFile);

    const func = module.default;
    if (typeof func !== "function") {
      throw new Error(
        `Default export from function ${functionId} is not a function: ${typeof module.default} module: ${JSON.stringify(
          module
        )}`
      );
    }
    return module;
  } catch (e: any) {
    // Handle esbuild build failures (e.g., syntax errors)
    if (e.errors && Array.isArray(e.errors)) {
      const errorMessages = e.errors.map((err: any) => err.text).join("\n");
      throw new Error(`Failed to compile function ${functionId}:\n${errorMessages}`);
    }
    throw e;
  }
}

// Virtual module that provides @jitsu/functions-lib exports from globalThis.
// Used in IIFE builds where the real package can't be resolved (platform: "neutral").
// Classes (RetryError, NoRetryError) are set on globalThis by the worker before UDF evaluation.
// toJitsuClassic/fromJitsuClassic are rarely used by UDFs; stub with clear error.
const FUNCTIONS_LIB_SHIM = Object.keys(functionLib)
  .map(exportName => `export const ${exportName} = globalThis.${exportName};`)
  .join("\n");

// esbuild plugin that resolves @jitsu/functions-lib to a virtual module
// providing exports from globalThis (set by the worker before UDF evaluation).
function functionsLibShimPlugin(): esbuild.Plugin {
  return {
    name: "functions-lib-shim",
    setup(build) {
      build.onResolve({ filter: /^@jitsu\/functions-lib$/ }, () => ({
        path: "@jitsu/functions-lib",
        namespace: "functions-lib-shim",
      }));
      build.onLoad({ filter: /.*/, namespace: "functions-lib-shim" }, () => ({
        contents: FUNCTIONS_LIB_SHIM,
        loader: "js",
      }));
    },
  };
}

// Compile UDF function from code string using esbuild.
// Returns the path to the compiled .mjs temp file (does NOT import it).
export async function compileUdfToFile(
  connectionId: string,
  code: string,
  functionId: string,
  env: any
): Promise<string> {
  const envs = `
  const process = { env: ${JSON.stringify(env || {})}};
  const console = { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {}, dir() {}, table() {} };
  `;
  // Prepend globals preamble to user code so it gets bundled together
  const fullCode = envs + code;

  const result = await esbuild.build({
    stdin: {
      contents: fullCode,
      loader: "js",
      resolveDir: process.cwd(), // Needed for resolving node_modules
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node20",
    plugins: [functionsLibShimPlugin(), createWhitelistPlugin(ALLOWED_PACKAGES)],
    logLevel: "silent", // We'll handle errors ourselves
  });

  if (result.errors.length > 0) {
    const errorMessages = result.errors.map(e => e.text).join("\n");
    throw new Error(`Failed to compile function ${functionId}:\n${errorMessages}`);
  }

  // Write to temp file for readable stack traces
  await ensureUdfTempDir();
  const sanitizedId = sanitizeFunctionId(connectionId + "-" + functionId);
  const tempFile = path.join(UDF_TEMP_DIR, `${sanitizedId}.mjs`);
  const bundledCode = result.outputFiles[0].text;
  await fsp.writeFile(tempFile, bundledCode);

  return tempFile;
}

// Compile UDF to an IIFE code string for use inside Deno Web Workers.
// The result is a self-contained string that, when evaluated via
//   `new Function(iifeCode + "\nreturn __udf;")()`,
// returns an object with { default: <function>, config?: ... }.
//
// Unlike compileUdfToFile, this does NOT write to disk – the code string
// is sent to the worker via postMessage.
export async function compileUdfToIIFE(code: string, functionId: string, env: any): Promise<string> {
  const envs = `var process = { env: ${JSON.stringify(
    env || {}
  )} };\nvar console = { log() {}, warn() {}, error() {}, info() {}, debug() {}, trace() {}, dir() {}, table() {} };\n`;
  const fullCode = envs + code;

  const result = await esbuild.build({
    stdin: {
      contents: fullCode,
      loader: "js",
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "__udf",
    platform: "node",
    target: "es2022",
    plugins: [functionsLibShimPlugin(), createWhitelistPlugin(ALLOWED_PACKAGES)],
    logLevel: "silent",
  });

  if (result.errors.length > 0) {
    const errorMessages = result.errors.map(e => e.text).join("\n");
    throw new Error(`Failed to compile function ${functionId}:\n${errorMessages}`);
  }

  return result.outputFiles[0].text;
}
