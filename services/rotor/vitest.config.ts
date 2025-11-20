import { mergeConfig } from "vitest/config";
import baseConfig from "@jitsu/common-config/vitest.config";

// Note: Tests do not support parallelism due to shared state/resources
export default mergeConfig(baseConfig, {
  test: {
    setupFiles: ["@jitsu/common-config/vitest.setup.ts"],
    fileParallelism: false,
    maxConcurrency: 1,
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
