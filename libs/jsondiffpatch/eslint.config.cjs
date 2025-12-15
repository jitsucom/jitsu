const { defineConfig, globalIgnores } = require("eslint/config");

const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const js = require("@eslint/js");

const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = defineConfig([
  {
    extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended-type-checked"),

    plugins: {
      "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
      parser: tsParser,

      parserOptions: {
        project: true,
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    files: ["test/**/*.ts"],
    extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended-type-checked"),

    plugins: {
      "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
      parser: tsParser,

      parserOptions: {
        project: "./test/tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
  },
  globalIgnores([
    "**/*\\{.,-}min.js",
    "**/node_modules",
    "**/build",
    "**/.git",
    "**/coverage",
    "**/dist",
    "**/lib",
    "eslint.config.cjs",
    "jest.config.cjs",
  ]),
]);
