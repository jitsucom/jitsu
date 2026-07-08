import { setupServer } from "msw/node";

// One MSW server per worker fork. It starts with no handlers — test files
// register per-test handlers via `server.use(...)`; setup.ts resets them after
// each test. Any outbound HTTP request without a handler fails the test loudly,
// except requests to hosts in `passthroughPrefixes` (the ClickHouse container —
// @clickhouse/client speaks HTTP and must not be intercepted).
export const server = setupServer();

export const passthroughPrefixes: string[] = [];

export function startMsw() {
  server.listen({
    onUnhandledRequest(request) {
      if (passthroughPrefixes.some(prefix => request.url.startsWith(prefix))) {
        return; // not handled by MSW → performed against the real network
      }
      throw new Error(
        `Unhandled outbound HTTP request in test: ${request.method} ${request.url}. ` +
          `Register an MSW handler via server.use(...) or add the host to passthroughPrefixes.`
      );
    },
  });
}
