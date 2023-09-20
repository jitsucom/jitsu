import chalk from "chalk";
import path from "path";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import typescript from "@rollup/plugin-typescript";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import rollupJson from "@rollup/plugin-json";
import { ModuleFormat, rollup } from "rollup";
import { exec } from "child_process";
import { loadPackageJson } from "./shared";

export async function build({ dir }: { dir?: string }) {
  const projectDir = dir || process.cwd();
  console.log(`Building project in ${chalk.bold(projectDir)}`);

  const packageJson = loadPackageJson(projectDir);

  const indexFile = path.resolve(projectDir, "src/index.ts");

  process.chdir(projectDir);

  const tsconfigPath = path.resolve(projectDir, "tsconfig.json");
  if (!existsSync(tsconfigPath)) {
    //workaround for bug https://github.com/rollup/plugins/issues/1572
    writeFileSync(tsconfigPath, "{}");
  }

  const rollupPlugins = [
    typescript(),
    resolve({ preferBuiltins: false }),
    commonjs(),
    rollupJson(),
    // terser(),
  ];

  const bundle = await rollup({
    input: [indexFile],
    plugins: rollupPlugins,
    logLevel: "silent",
  });

  let format: ModuleFormat = "es";
  let output = await bundle.generate({
    dir: projectDir,
    format: format,
  });

  mkdirSync(path.resolve(projectDir, "dist"), { recursive: true });
  writeFileSync(path.resolve(projectDir, "dist/index.js"), output.output[0].code);

  console.log(`\n${chalk.bold("Build finished.")}`);
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
