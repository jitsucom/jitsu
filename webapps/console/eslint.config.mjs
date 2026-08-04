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
  // Type-aware unsafe-`any` rules on the admin API surface. The config export
  // endpoints feed bulker/rotor/syncctl directly; an implicit `any` here is how
  // the 2026-07-30 blank-options incident compiled (JITSU-158) — a
  // destructuring typo on a Prisma result the checker had silently collapsed
  // to `any`. These rules make any such collapse a lint failure instead.
  {
    files: ["pages/api/admin/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
    },
  },
]);

export default eslintConfig;
