import { availableParallelism } from "os";
import { defineConfig } from "vitest/config";

const numCores = availableParallelism();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
    fileParallelism: true,
    maxConcurrency: numCores,
    pool: "threads",
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: numCores,
      },
    },
  },
});
