import { mergeConfig } from "vitest/config";
import baseConfig from "@jitsu/common-config/vitest.config";
import path from "path";

export default mergeConfig(baseConfig, {
  resolve: {
    alias: {
      jsondiffpatch: path.resolve(__dirname, "../jsondiffpatch/src/index.ts"),
    },
  },
  test: {
    include: ["**/__tests__/node/**/*.test.ts"],
    exclude: ["**/__tests__/playwright/**/*", "**/node_modules/**"],
  },
});
