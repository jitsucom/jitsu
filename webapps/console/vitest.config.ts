import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

// Load `.sql` files as raw string modules (`export default "<contents>"`),
// mirroring Next's raw-loader. clickhouse-init.ts imports the .clickhouse.sql
// DDL templates this way; without this the integration setup (which imports it)
// would fail to resolve them. vite:esbuild ignores the .sql extension, so the
// JS we return here passes through untransformed.
function rawSql(): Plugin {
  return {
    name: "raw-sql",
    load(id) {
      const file = id.split("?")[0];
      if (file.endsWith(".sql")) {
        return `export default ${JSON.stringify(readFileSync(file, "utf-8"))};`;
      }
      return null;
    },
  };
}

// Two projects:
//   unit        — pure tests, no external dependencies. Runs anywhere, instantly.
//   integration — service tests against real Postgres + ClickHouse
//                 (testcontainers) with MSW intercepting outbound HTTP.
//                 Requires Docker. globalSetup boots the containers once per
//                 run; each test file gets its own database cloned from a
//                 template (see __tests__/integration/support/).
// Running only unit tests (vitest run --project unit, or a file filter that
// matches nothing under __tests__/integration/) starts no containers.
export default defineConfig({
  plugins: [rawSql()],
  // Use the automatic JSX runtime so tests that transitively import `.tsx` files
  // (e.g. the destinations catalog → icon components) don't fail with
  // "React is not defined". The app compiles JSX via Next's automatic runtime;
  // this keeps vitest consistent (tsconfig keeps `jsx: preserve` for Next).
  esbuild: { jsx: "automatic" },
  test: {
    globals: true,
    environment: "node",
    unstubEnvs: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["__tests__/unit/**/*.test.ts"],
          // Dummy env so module-load singletons don't throw on transitive
          // imports (serverEnv requires DATABASE_URL/JWT_SECRET; clickhouse.ts
          // builds its — lazy, never connected — client at module load). The
          // integration project gets real values from its setup file instead.
          env: {
            DATABASE_URL: "postgres://test:test@localhost:5432/test",
            JWT_SECRET: "test-jwt-secret",
            NEXTAUTH_SECRET: "test-nextauth-secret",
            CLICKHOUSE_URL: "http://localhost:8123",
          },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["__tests__/integration/**/*.test.ts"],
          globalSetup: ["./__tests__/integration/support/global-setup.ts"],
          setupFiles: ["./__tests__/integration/support/setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
