const typescript = require("@rollup/plugin-typescript");

module.exports = [
  {
    plugins: [typescript()],
    input: ["./src/index.ts"],
    output: [
      { file: "dist/index.es.js", format: "es" },
      { file: "dist/index.cjs.js", format: "cjs" },
    ],
  },
];
