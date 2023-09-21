import chalk from "chalk";
import path from "path";
import { existsSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import rollupJson from "@rollup/plugin-json";
import { ModuleFormat, rollup } from "rollup";
import { exec } from "child_process";
import { loadPackageJson } from "./shared";
import { b } from "../lib/chalk-code-highlight";

export async function build({ dir }: { dir?: string }) {
  const projectDir = dir || process.cwd();
  const packageJson = loadPackageJson(projectDir);

  console.log(`Building ${b(packageJson.name)} project`);

  //list files in src directory
  const functionsDir = path.resolve(projectDir, "src/functions");
  const files = readdirSync(functionsDir);
  if (files.length === 0) {
    console.error(`No functions found in ${b("/src/functions")} directory`);
    process.exit(0);
  }
  for (const file of files) {
    console.log(`Building function ${b(file)}`);
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
      logLevel: "silent",
    });

    let format: ModuleFormat = "es";
    let output = await bundle.generate({
      dir: projectDir,
      format: format,
    });

    mkdirSync(path.resolve(projectDir, "dist/functions"), { recursive: true });
    writeFileSync(path.resolve(projectDir, `dist/functions/${file.replace(".ts", ".js")}`), output.output[0].code);
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
