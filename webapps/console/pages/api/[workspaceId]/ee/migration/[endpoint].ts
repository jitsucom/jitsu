import { Api, inferUrl, nextJsApiHandler, verifyAccess } from "../../../../../lib/api";
import { z } from "zod";
import { assertTrue } from "juava";
import { eeAuthHeadersOrServiceToken, getEeConnection, isEEAvailable } from "../../../../../lib/server/ee";
import { ApiError } from "../../../../../lib/shared/errors";
import { getClientIp } from "../../../../../lib/server/origin";
import { getRateLimiter, setRateLimitHeaders } from "../../../../../lib/server/rate-limit";
import { getServerEnv } from "../../../../../lib/server/serverEnv";

/**
 * Console-side proxy for the ee-api migration analyzer (JITSU-131). The
 * browser talks to console only; console authenticates the user, verifies
 * workspace access, applies an additional per-IP rate limit (parse-invoice
 * spends OpenAI money per call; analyze reads the customer's provider
 * workspace), and forwards to ee-api with the caller's Firebase auth or the
 * service token. The per-user session limiter of the API framework applies on
 * top. Provider tokens and invoice files pass through — never logged/stored.
 */

// parse-invoice carries a ~14 MB base64 body; analyze an OSS workspaceConfig.
export const config = { api: { bodyParser: { sizeLimit: "15mb" } } };

const PROXIED: Record<string, { method: "GET" | "POST"; ipLimit: number; windowMs: number }> = {
  report: { method: "GET", ipLimit: 120, windowMs: 60_000 },
  analyze: { method: "POST", ipLimit: 10, windowMs: 60_000 },
  "parse-invoice": { method: "POST", ipLimit: 5, windowMs: 60_000 },
  "report-usage": { method: "POST", ipLimit: 20, windowMs: 60_000 },
};

const querySchema = z.object({
  workspaceId: z.string(),
  endpoint: z.string(),
  id: z.string().optional(),
});

async function proxy(opts: { user: any; req: any; res: any; query?: z.infer<typeof querySchema>; body?: any }) {
  const { user, req, res, body } = opts;
  const query = opts.query!;
  assertTrue(isEEAvailable(), "EE api is not available");
  const spec = PROXIED[query.endpoint];
  if (!spec || spec.method !== req.method) {
    throw new ApiError(`Unknown migration endpoint ${query.endpoint}`, { status: 404 });
  }
  await verifyAccess(user, query.workspaceId);
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
  const url = new URL(`${getEeConnection().host}api/migration/${query.endpoint}`);
  if (spec.method === "GET") {
    url.searchParams.set("workspaceId", query.workspaceId);
    if (query.id) {
      url.searchParams.set("id", query.id);
    }
  }
  const response = await fetch(url, {
    method: spec.method,
    headers: { "Content-Type": "application/json", ...eeAuthHeadersOrServiceToken(req, user) },
    // workspaceId is pinned to the path param — the browser can't proxy into
    // another workspace it happens to know an id for.
    body: spec.method === "POST" ? JSON.stringify({ ...(body ?? {}), workspaceId: query.workspaceId }) : undefined,
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
    auth: true,
    types: { query: querySchema, result: z.any() },
    handle: proxy,
  },
  POST: {
    auth: true,
    types: { query: querySchema, body: z.any(), result: z.any() },
    handle: proxy,
  },
};

export default nextJsApiHandler(api);
