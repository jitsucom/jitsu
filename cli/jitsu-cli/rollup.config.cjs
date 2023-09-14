const multi = require("@rollup/plugin-multi-entry");
const resolve = require("@rollup/plugin-node-resolve");
const commonjs = require("@rollup/plugin-commonjs");
const rollupJson = require("@rollup/plugin-json");
const typescript = require("@rollup/plugin-typescript");
const babel = require("@rollup/plugin-babel");

module.exports = [
  {
    plugins: [
      resolve({ preferBuiltins: false }),
      multi(),
      typescript(),
      commonjs(),
      rollupJson(),
      babel({
        babelHelpers: "inline",
        babelrc: false,
        extensions: [".js", ".ts"],
      }),
    ],
    input: "./src/index.ts",
    output: [{ file: "dist/main.es.js", format: "es" }],
  },
];
