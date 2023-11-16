const multi = require("@rollup/plugin-multi-entry");
const resolve = require("@rollup/plugin-node-resolve");
const commonjs = require("@rollup/plugin-commonjs");
const rollupJson = require("@rollup/plugin-json");
const terser = require("@rollup/plugin-terser");


module.exports = [
  {
    plugins: [
      multi(),
      resolve({ preferBuiltins: false }),
      commonjs(),
      rollupJson(),
      (process.JITSU_JS_DEBUG_BUILD = "1" ? undefined : terser()),
    ],
    input: "./compiled/src/browser.js",
    output: {
      file: `dist/web/p.js.txt`,
      format: "iife",
      sourcemap: false,
    },
  },
  {
    plugins: [multi(), resolve({ preferBuiltins: false }), commonjs(), rollupJson()],
    input: ["./compiled/src/index.js", "./compiled/src/jitsu.js", "./compiled/src/analytics-plugin.js"],
    output: [
      { file: "dist/jitsu.es.js", format: "es" },
      { file: "dist/jitsu.cjs.js", format: "cjs" },
    ],
  },
];
