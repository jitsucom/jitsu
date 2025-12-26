import { mergeConfig } from "vitest/config";
import baseConfig from "@jitsu/common-config/vitest.config";

// Note: Tests do not support parallelism due to shared state/resources
// Using 'forks' pool to avoid V8 isolate crashes with isolated-vm (used by UDF wrapper)
export default mergeConfig(baseConfig, {
  test: {
    setupFiles: ["@jitsu/common-config/vitest.setup.ts"],
    fileParallelism: false,
    maxConcurrency: 1,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    env: {
      //The variables from below should exist, but their values are actually not being used
      KAFKA_BOOTSTRAP_SERVERS: "dummy",
      BULKER_URL: "http://dummy",
      BULKER_AUTH_KEY: "dummy",
      REPOSITORY_BASE_URL: "",
    },
  },
});
