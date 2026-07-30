import { Api, getUser, inferUrl, nextJsApiHandler, verifyAccess } from "../../../lib/api";
import { z } from "zod";
import { assertTrue } from "juava";
import {
  eeAuthHeadersOrServiceToken,
  getEeConnection,
  isEEAvailable,
  serviceTokenHeaders,
} from "../../../lib/server/ee";
import { ApiError } from "../../../lib/shared/errors";
import { getClientIp } from "../../../lib/server/origin";
import { getRateLimiter, setRateLimitHeaders } from "../../../lib/server/rate-limit";
import { getServerEnv } from "../../../lib/server/serverEnv";

/**
 * Console-side proxy for the ee-api migration analyzer (JITSU-131 / JITSU-128).
 * The browser talks to console only; console applies per-IP rate limits
 * (parse-invoice spends OpenAI money per call; analyze reads the customer's
 * provider workspace) and forwards to ee-api.
 *
 * Two modes:
 *  - `workspaceId` param present → the caller must be signed in and a member
 *    of that workspace; forwarded with the caller's auth (or service token).
 *  - no `workspaceId` → anonymous/teaser mode: forwarded with the service
 *    token; report access is gated by the per-report `accessCode` which
 *    ee-api returns from `analyze` and expects back on reads/updates.
 *
 * Provider tokens and invoice files pass through — never logged or stored.
 */

// parse-invoice carries a ~14 MB base64 body; analyze an OSS workspaceConfig.
export const config = { api: { bodyParser: { sizeLimit: "15mb" } } };

const PROXIED: Record<string, { method: "GET" | "POST"; ipLimit: number; windowMs: number }> = {
  report: { method: "GET", ipLimit: 120, windowMs: 60_000 },
  analyze: { method: "POST", ipLimit: 10, windowMs: 60_000 },
  "parse-invoice": { method: "POST", ipLimit: 5, windowMs: 60_000 },
  "report-usage": { method: "POST", ipLimit: 20, windowMs: 60_000 },
  lead: { method: "POST", ipLimit: 10, windowMs: 60_000 },
};

function isAllowedOrigin(origin: string): boolean {
  // The marketing site's savings teaser (JITSU-129) calls this proxy cross-origin.
  const allowed = new Set([
    "https://jitsu.com",
    "https://www.jitsu.com",
    // Origins are scheme+host(+port) — normalize away accidental trailing
    // slashes in configured entries so they match real Origin headers.
    ...(getServerEnv().MIGRATION_CORS_ORIGINS ?? "")
      .split(",")
      .map(o => o.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  ]);
  if (allowed.has(origin)) {
    return true;
  }
  // Local dev: the websites repo serves at https://web[-branch].jitsu.localhost
  // (portless) or http://localhost:<port>. *.localhost never resolves publicly,
  // and these endpoints are anonymous/cookie-less, so this is safe to keep on.
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

function applyCors(req: any, res: any): void {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset"
    );
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

const querySchema = z.object({
  endpoint: z.string(),
  workspaceId: z.string().optional(),
  id: z.string().optional(),
  accessCode: z.string().optional(),
});

async function proxy(opts: { req: any; res: any; query?: z.infer<typeof querySchema>; body?: any }) {
  const { req, res, body } = opts;
  const query = opts.query!;
  applyCors(req, res);
  assertTrue(isEEAvailable(), "EE api is not available");
  const spec = PROXIED[query.endpoint];
  if (!spec || spec.method !== req.method) {
    throw new ApiError(`Unknown migration endpoint ${query.endpoint}`, { status: 404 });
  }
  if (getServerEnv().MINUTE_RATE_LIMIT_ENABLED) {
    const rl = await getRateLimiter().check({
      authClass: "ip",
      principal: getClientIp(req),
      method: spec.method,
      bucket: `migration-${query.endpoint}`,
      limit: spec.ipLimit,
      windowMs: spec.windowMs,
    });
    setRateLimitHeaders(res, rl);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      throw new ApiError("Too many requests — try again later", { status: 429 });
    }
  }
  let headers: Record<string, string>;
  if (query.workspaceId) {
    const user = await getUser(res, req);
    if (!user) {
      throw new ApiError("Authorization required when workspaceId is specified", { status: 401 });
    }
    await verifyAccess(user, query.workspaceId);
    headers = eeAuthHeadersOrServiceToken(req, user);
  } else {
    // Anonymous/teaser mode: console vouches via the service token; ee-api
    // scopes anonymous access by the report accessCode, not a workspace.
    // Require an allow-listed Origin so this isn't an open service-token
    // proxy for arbitrary scripts. Origin is spoofable outside browsers —
    // this is defense-in-depth on top of the per-IP rate limits above, which
    // remain the real guard on quota/LLM spend.
    const origin = req.headers.origin;
    if (!origin || !isAllowedOrigin(origin)) {
      throw new ApiError("Anonymous access requires workspaceId", { status: 403 });
    }
    headers = serviceTokenHeaders();
  }
  const url = new URL(`${getEeConnection().host}api/migration/${query.endpoint}`);
  if (spec.method === "GET") {
    for (const param of ["workspaceId", "id", "accessCode"] as const) {
      if (query[param]) {
        url.searchParams.set(param, query[param]!);
      }
    }
  }
  const response = await fetch(url, {
    method: spec.method,
    headers: { "Content-Type": "application/json", ...headers },
    // workspaceId is pinned to the (access-verified) query param — the browser
    // can't proxy into another workspace via the body.
    body:
      spec.method === "POST"
        ? JSON.stringify({ ...(body ?? {}), workspaceId: query.workspaceId ?? undefined })
        : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(json?.error || `ee-api responded ${response.status}`, { status: response.status });
  }
  return json;
}

export const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: false,
    types: { query: querySchema, result: z.any() },
    handle: proxy,
  },
  POST: {
    auth: false,
    types: { query: querySchema, body: z.any(), result: z.any() },
    handle: proxy,
  },
  OPTIONS: {
    auth: false,
    types: { result: z.any() },
    handle: async ({ req, res }) => {
      applyCors(req, res);
      res.status(204).end();
    },
  },
};

export default nextJsApiHandler(api);
