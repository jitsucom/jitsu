import path from "path";
import { mkdirSync, readdirSync, existsSync, lstatSync } from "fs";
import * as esbuild from "esbuild";
import { exec } from "child_process";
import { loadPackageJson } from "./shared";
import { b, green, red } from "../lib/chalk-code-highlight";
import { getFunctionFromFilePath } from "../lib/compiled-function";
import * as ts from "typescript";

export async function build({ dir }: { dir?: string }) {
  const { packageJson, projectDir } = await loadPackageJson(dir || process.cwd());

  console.log(`Building ${b(packageJson.name)} project`);
  const errors = checkTypescript(projectDir);
  if (errors) {
    console.error(`Found ${errors.length} errors in functions files. Exiting`);
    process.exit(1);
  }

  try {
    await buildFiles(projectDir, "functions");
    await buildFiles(projectDir, "profiles");
  } catch (e: any) {
    throw new Error(
      `Some of the functions failed to compile. See details above. Last error: ${e.message || "unknown"}`
    );
  }

  console.log(`${b("Build finished.")}`);
}

const run = async cmd => {
  const child = exec(cmd, err => {
    if (err) {
      console.error(err);
      return;
    }
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  return new Promise(resolve => child.on("close", resolve));
};

async function buildFiles(projectDir: string, dir: string = "") {
  let lastError: any = undefined;
  const srcDir = path.resolve(projectDir, "src", dir);
  if (!existsSync(srcDir)) {
    console.info(`${b(dir)} directory not found in ${b(path.resolve(projectDir, "src"))}`);
    return;
  }
  const files = readdirSync(srcDir);
  if (files.length === 0) {
    console.warn(`No functions found in ${b(srcDir)} directory`);
    return;
  }
  for (const file of files) {
    if (lstatSync(path.resolve(srcDir, file)).isDirectory()) {
      try {
        await buildFiles(projectDir, path.join(dir, file));
      } catch (e: any) {
        lastError = e;
      }
      continue;
    }
    try {
      await buildFile(projectDir, dir, file);
    } catch (e: any) {
      console.error(
        [
          `${red(`⚠`)} Function ${b(file)} failed to compile: ${red(e?.message)}. See details below`,
          ...(e?.stack?.split("\n") || []).map(s => `  ${s}`),
        ]
          .filter(Boolean)
          .join("\n")
      );
      lastError = e;
    }
  }
  if (lastError) {
    throw lastError;
  }
}

async function buildFile(projectDir: string, dir: string, fileName: string) {
  const funcFile = path.resolve(projectDir, "src", path.join(dir, fileName));
  process.chdir(projectDir);

  mkdirSync(path.resolve(projectDir, "dist/" + dir), { recursive: true });
  const compiledFunctionPath = `dist/${dir}/${fileName.replace(".ts", ".js")}`;

  await esbuild.build({
    entryPoints: [funcFile],
    absWorkingDir: projectDir,
    bundle: true,
    platform: "neutral",
    format: "esm",
    outfile: path.resolve(projectDir, compiledFunctionPath),
    external: ["@jitsu/functions-lib"],
    logLevel: "silent",
    loader: {
      ".json": "json",
    },
    // Resolve dependencies from the user's project node_modules
    nodePaths: [path.resolve(projectDir, "node_modules")],
  });

  //to verify that function is readable
  const compiledFunction = await getFunctionFromFilePath(
    projectDir,
    path.resolve(projectDir, compiledFunctionPath),
    "function"
  );
  console.log(
    [`${green(`✓`)} Function ${b(fileName)} compiled successfully`, `  slug = ${b(compiledFunction.meta.slug)}`]
      .filter(Boolean)
      .join("\n")
  );
}

function checkTypescript(projectDir: string): string[] | void {
  const tsconfigPath = path.resolve(projectDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    console.info(`No ${b("tsconfig.json")} file found in ${b(projectDir)}. Assuming JavaScript project`);
    return;
  }
  let compilerOptions: ts.CompilerOptions = {};
  let filenames: string[] = [];
  const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  tsconfig.config.compilerOptions = {
    ...tsconfig.config.compilerOptions,
    typeRoots: [path.resolve(projectDir, "node_modules", "@types")],
    checkJs: true,
    allowJs: true,
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: typeof compilerOptions.esModuleInterop !== "undefined" ? compilerOptions.esModuleInterop : true,
    moduleResolution:
      typeof compilerOptions.moduleResolution !== "undefined" ? compilerOptions.moduleResolution : "node",
    target: "esnext",
    module: "esnext",
  };
  const parsed = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, path.dirname(tsconfigPath));
  filenames = parsed.fileNames;
  compilerOptions = parsed.options;

  //console.log(`Filenames ${JSON.stringify(filenames)}`);

  let program = ts.createProgram(filenames, compilerOptions);
  let emitResult = program.emit();
  let allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  const errors: string[] = [];
  allDiagnostics.forEach(diagnostic => {
    let logF = console.log;
    switch (diagnostic.category) {
      case ts.DiagnosticCategory.Error:
        logF = (...args) => {
          console.error(...args);
          errors.push(args.join(" "));
        };
        break;
      case ts.DiagnosticCategory.Warning:
        logF = console.warn;
        break;
      case ts.DiagnosticCategory.Message:
      case ts.DiagnosticCategory.Suggestion:
        logF = console.info;
    }
    if (diagnostic.file) {
      let { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start!);
      let message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      logF(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`);
    } else {
      logF(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    }
  });
  if (errors.length > 0) {
    return errors;
  }
}
