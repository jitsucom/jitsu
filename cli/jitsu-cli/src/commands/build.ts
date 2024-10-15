import path from "path";
import { mkdirSync, readdirSync, writeFileSync, existsSync, lstatSync } from "fs";
import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import rollupJson from "@rollup/plugin-json";
import { ModuleFormat, rollup } from "rollup";
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
    await buildFiles(projectDir);
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

  const rollupPlugins = [
    typescript(),
    resolve({ preferBuiltins: false }),
    commonjs(),
    rollupJson(),
    // terser(),
  ];

  const bundle = await rollup({
    input: [funcFile],
    plugins: rollupPlugins,
    external: ["@jitsu/functions-lib"],
    logLevel: "silent",
  });

  let format: ModuleFormat = "es";
  let output = await bundle.generate({
    dir: projectDir,
    format: format,
  });

  mkdirSync(path.resolve(projectDir, "dist/" + dir), { recursive: true });
  const compiledFunctionPath = `dist/${dir}/${fileName.replace(".ts", ".js")}`;
  writeFileSync(path.resolve(projectDir, compiledFunctionPath), output.output[0].code);
  //to verify that function is readable
  const compiledFunction = await getFunctionFromFilePath(path.resolve(projectDir, compiledFunctionPath), "function");
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
  console.log(`Checking TypeScript files in ${b(projectDir)}`);
  let compilerOptions: ts.CompilerOptions = {};
  let filenames: string[] = [];
  const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  tsconfig.config.compilerOptions = {
    ...tsconfig.config.compilerOptions,
    typeRoots: [path.resolve(projectDir, "node_modules", "@types")],
    checkJs: true,
    allowJs: true,
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
