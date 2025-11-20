import { mergeConfig } from "vitest/config";
import baseConfig from "@jitsu/common-config/vitest.config";

export default mergeConfig(baseConfig, {
  test: {
    include: ["**/__tests__/node/**/*.test.ts"],
    exclude: ["**/__tests__/playwright/**/*", "**/node_modules/**"],
  },
});
