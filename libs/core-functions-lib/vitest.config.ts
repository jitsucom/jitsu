import { mergeConfig } from "vitest/config";
import baseConfig from "@jitsu/common-config/vitest.config";

export default mergeConfig(baseConfig, {
  test: {
    setupFiles: ["@jitsu/common-config/vitest.setup.ts"],
  },
});
