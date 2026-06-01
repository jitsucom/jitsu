import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { rpc } from "juava";
import { eeAuthHeaders, getEeConnection, isEEAvailable } from "../../../lib/server/ee";
import { ApiError } from "../../../lib/shared/errors";

// Catch-all server-side proxy: browser → /api/ee/<path> → billing-server.
// Forwards the request method, query, and body, and forwards the user's
// Firebase session as `x-fb-auth` so billing-server authenticates the call.
// The browser no longer needs to know the billing-server URL or carry a
// billing-server token.

const querySchema = z
  .object({
    path: z.array(z.string()),
  })
  .passthrough();

async function forward({ user, req, body, query }: any) {
  if (!isEEAvailable()) {
    throw new ApiError("EE is not available", {}, { status: 503 });
  }
  if (user.authType !== "firebase") {
    // ee-api user routes verify identity from the forwarded Firebase token.
    // The proxy intentionally refuses other auth types so we never reach
    // billing-server with the admin service token in place of a real user —
    // see lib/server/ee.ts for the same reasoning in eeAuthHeadersOrServiceToken.
    throw new ApiError("ee-api proxy is only available for Firebase-authenticated users", {}, { status: 401 });
  }
  const { host } = getEeConnection();
  const target = (query.path as string[]).join("/");
  // Strip the catch-all segments out of the forwarded query string.
  const { path: _drop, ...forwardQuery } = query as Record<string, unknown>;
  return await rpc(`${host}api/${target}`, {
    method: req.method,
    query: forwardQuery,
    body,
    headers: {
      "Content-Type": "application/json",
      ...eeAuthHeaders(req),
    },
  });
}

export default createRoute()
  .GET({ auth: true, query: querySchema })
  .handler(forward)
  .POST({ auth: true, query: querySchema, body: z.any() })
  .handler(forward)
  .toNextApiHandler();
