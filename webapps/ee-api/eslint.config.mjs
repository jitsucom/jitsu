import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  {
    rules: {
      "no-unused-vars": "off",
      "react/jsx-curly-brace-presence": [
        "off",
        {
          props: "never",
        },
      ],

      "react/no-unescaped-entities": 0,
      "@next/next/no-img-element": 0,
      "import/no-anonymous-default-export": 0,
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
    files: ["**/next.config.js"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
]);

export default eslintConfig;
