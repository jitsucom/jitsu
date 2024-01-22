import path from "path";
import { mkdirSync, readdirSync, writeFileSync } from "fs";
import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import rollupJson from "@rollup/plugin-json";
import { ModuleFormat, rollup } from "rollup";
import { exec } from "child_process";
import { loadPackageJson } from "./shared";
import { b, green, red } from "../lib/chalk-code-highlight";
import { CompiledFunction, getFunctionFromFilePath } from "../lib/compiled-function";

export async function build({ dir }: { dir?: string }) {
  const { packageJson, projectDir } = await loadPackageJson(dir || process.cwd());

  console.log(`Building ${b(packageJson.name)} project`);

  //list files in src directory
  const functionsDir = path.resolve(projectDir, "src/functions");
  const files = readdirSync(functionsDir);
  if (files.length === 0) {
    console.error(`No functions found in ${b("/src/functions")} directory`);
    process.exit(0);
  }
  let compiledFunction: CompiledFunction;
  let lastError: any = undefined;
  for (const file of files) {
    try {
      const funcFile = path.resolve(functionsDir, file);

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

      mkdirSync(path.resolve(projectDir, "dist/functions"), { recursive: true });
      const compiledFunctionPath = `dist/functions/${file.replace(".ts", ".js")}`;
      writeFileSync(path.resolve(projectDir, compiledFunctionPath), output.output[0].code);
      //to verify that function is readable
      compiledFunction = await getFunctionFromFilePath(path.resolve(projectDir, compiledFunctionPath));
      console.log(
        [`${green(`✓`)} Function ${b(file)} compiled successfully`, `  slug = ${b(compiledFunction.meta.slug)}`]
          .filter(Boolean)
          .join("\n")
      );
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
    throw new Error(
      `Some of the functions failed to compile. See details above. Last error: ${lastError?.message || "unknown"}`
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
