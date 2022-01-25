import typescript from "rollup-plugin-typescript2"
import babel from "@rollup/plugin-babel"

export default [
  {
    input: "./index.ts",
    plugins: [typescript(), babel({ babelHelpers: "bundled" })],
    output: {
      dir: "dist",
      format: "esm",
      preserveModules: true,
    },
  },
]
