import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { eeAuthHeaders, getEeConnection, isEEAvailable } from "../../../lib/server/ee";
import { ApiError } from "../../../lib/shared/errors";

// Catch-all server-side proxy: browser → /api/ee/<path> → billing-server.
// Forwards the request method, query, and body; attaches the user's Firebase
// credential as `x-fb-auth` so billing-server authenticates the call.
// The browser no longer needs to know the billing-server URL or carry a
// billing-server token.
//
// Auth note: `getUser()` (lib/api.ts) routes `Authorization: Bearer …` to the
// API-key path (`keyId:secret`) and would reject a raw Firebase ID token before
// it ever reaches this handler. So in the current console, `authType === "firebase"`
// implies the `jitsu-auth` cookie is set. The try/catch around `eeAuthHeaders`
// is defensive — if the cookie ever ends up missing we want a clean 401 instead
// of a 500 from `requireDefined`. Supporting Bearer Firebase ID tokens is a
// separate change to `getUser` and is out of scope here.

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
    // billing-server with the admin service token in place of a real user.
    throw new ApiError("ee-api proxy is only available for Firebase-authenticated users", {}, { status: 401 });
  }
  let fbHeaders: Record<string, string>;
  try {
    fbHeaders = eeAuthHeaders(req);
  } catch {
    throw new ApiError("Missing Firebase credentials for ee-api proxy", {}, { status: 401 });
  }

  const { host } = getEeConnection();
  const { path: _drop, ...forwardQuery } = query as Record<string, unknown>;
  // Reject dot-segments and embedded slashes before constructing the URL —
  // otherwise `..` (or its URL-encoded form `%2e%2e`, which Next.js has already
  // decoded into the catch-all segments) could let the request escape the
  // `/api/` prefix and hit unrelated billing-server paths.
  const segments = query.path as string[];
  for (const seg of segments) {
    if (!seg || seg === "." || seg === ".." || seg.includes("/") || seg.includes("\\")) {
      throw new ApiError("Invalid path segment", { segment: seg }, { status: 400 });
    }
  }
  const targetUrl = new URL(`${host}api/${segments.join("/")}`);
  for (const [k, v] of Object.entries(forwardQuery)) {
    if (v === undefined || v === null) {
      continue;
    }
    if (Array.isArray(v)) {
      v.forEach(item => targetUrl.searchParams.append(k, String(item)));
    } else {
      targetUrl.searchParams.set(k, String(v));
    }
  }

  const method = (req.method || "GET").toUpperCase();
  const init: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...fbHeaders,
    },
  };
  if (method !== "GET" && method !== "HEAD" && body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  // Use `fetch` directly (instead of `juava.rpc`) so we can map billing-server's
  // status code into the response. `rpc` raises `ApiResponseError` whose shape
  // doesn't match the framework's `isApiError` check, which would surface every
  // upstream 4xx as a generic 500 with a stack trace.
  const response = await fetch(targetUrl, init);
  const text = await response.text();
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  let parsed: any;
  if (isJson && text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  } else {
    parsed = text;
  }

  if (!response.ok) {
    const message =
      (isJson && parsed && typeof parsed === "object" && (parsed.message || parsed.error)) ||
      `ee-api returned ${response.status}`;
    const responseObject = isJson && parsed && typeof parsed === "object" ? parsed : { upstreamBody: parsed };
    throw new ApiError(message, responseObject, { status: response.status });
  }

  return parsed;
}

export default createRoute()
  .GET({ auth: true, query: querySchema })
  .handler(forward)
  .POST({ auth: true, query: querySchema, body: z.any() })
  .handler(forward)
  .toNextApiHandler();
