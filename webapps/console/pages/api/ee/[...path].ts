import type { NextApiRequest } from "next";
import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { firebaseAuthCookieName } from "../../../lib/server/firebase-server";
import { getEeConnection, isEEAvailable } from "../../../lib/server/ee";
import { ApiError } from "../../../lib/shared/errors";

// Catch-all server-side proxy: browser → /api/ee/<path> → billing-server.
// Forwards the request method, query, and body; attaches the user's Firebase
// credential as `x-fb-auth` so billing-server authenticates the call.
// The browser no longer needs to know the billing-server URL or carry a
// billing-server token.

const querySchema = z
  .object({
    path: z.array(z.string()),
  })
  .passthrough();

// getFirebaseUser accepts the credential from either the `jitsu-auth` cookie or
// an `Authorization: Bearer <idToken>` header (lib/server/firebase-server.ts);
// both yield `authType === "firebase"`. Look in both places so the proxy works
// for browser-cookie callers AND programmatic Bearer callers.
function extractFirebaseToken(req: NextApiRequest): string | undefined {
  const cookieToken = req.cookies[firebaseAuthCookieName];
  if (cookieToken) {
    return cookieToken;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.substring("bearer ".length);
  }
  return undefined;
}

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
  const firebaseToken = extractFirebaseToken(req);
  if (!firebaseToken) {
    // 401 (not 500) when the Firebase user was authenticated via a header that
    // isn't reachable here — keeps clients honest about retrying with credentials.
    throw new ApiError("Missing Firebase credentials for ee-api proxy", {}, { status: 401 });
  }

  const { host } = getEeConnection();
  const { path: _drop, ...forwardQuery } = query as Record<string, unknown>;
  const targetUrl = new URL(`${host}api/${(query.path as string[]).join("/")}`);
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
      "x-fb-auth": firebaseToken,
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
