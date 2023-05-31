const multi = require("@rollup/plugin-multi-entry");
const resolve = require("@rollup/plugin-node-resolve");
const commonjs = require("@rollup/plugin-commonjs");
const rollupJson = require("@rollup/plugin-json");
const babel = require("@rollup/plugin-babel");
const typescript = require("@rollup/plugin-typescript");

module.exports = [
  {
    plugins: [
      multi(),
      resolve({ preferBuiltins: false }),
      commonjs(),
      rollupJson(),
      babel({
        babelpHelpers: "inline",
        babelrc: false,
        extensions: ['.js', '.ts']

      }),
    ],
    input: "./compiled/index.js",
    output: {
      file: `dist/rotor.js`,
      format: "iife",
      sourcemap: true,
    },
  },
];
