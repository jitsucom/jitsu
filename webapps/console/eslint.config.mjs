import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import unusedImports from "eslint-plugin-unused-imports";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    plugins: {
      "unused-imports": unusedImports,
    },

    rules: {
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",

      "react/jsx-curly-brace-presence": [
        "off",
        {
          props: "never",
        },
      ],

      "react/no-unescaped-entities": 0,
      "@next/next/no-img-element": 0,
      "import/no-anonymous-default-export": 0,
      "react-hooks/set-state-in-effect": 0,
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Direct access to process.env is not allowed. Use serverEnv from lib/server/serverEnv.ts or clientEnv from lib/shared/clientEnv.ts instead.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["lib/server/serverEnv.ts", "lib/shared/clientEnv.ts", "**/next.config.js"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
]);

export default eslintConfig;
