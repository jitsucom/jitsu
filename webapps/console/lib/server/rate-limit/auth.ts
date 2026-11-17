import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { NextApiHandler, NextApiRequest, NextApiResponse } from "next";
import { authRateLimitMessage, type AuthRateLimitError } from "../../auth-errors";
import { getRateLimiter, setRateLimitHeaders } from ".";
import { getServerLog } from "../log";
import { isReadOnly } from "../maintenance";
import { getServerEnv } from "../serverEnv";
import { getPublicOrigin } from "../origin";
import { computeResult } from "./compute";
import type { RateLimitOpts } from "./types";

const log = getServerLog("auth-rate-limit");
const WINDOW = 60_000;

// Production ingress overwrites X-Real-IP. Direct deployments must do the
// same, or strip it. Never accept a caller-controlled X-Forwarded-For chain.
export function authClientIp(req: NextApiRequest): string {
  const header = req.headers["x-real-ip"];
  const ip = typeof header === "string" && isIP(header) ? header : req.socket.remoteAddress ?? "unknown";
  if (isIP(ip) !== 6) return ip;
  const normalized = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  if (normalized.startsWith("::ffff:")) {
    const parts = normalized.slice(7).split(":");
    if (parts.length === 2) {
      return parts.flatMap(part => [parseInt(part, 16) >> 8, parseInt(part, 16) & 255]).join(".");
    }
  }
  return normalized;
}

// NextAuth session polling, CSRF and provider discovery must not consume the
// login budget. Both GET OAuth callbacks and POST credentials are attempts.
export function isNextAuthAttempt(req: NextApiRequest): boolean {
  const action = req.query.nextauth;
  const first = Array.isArray(action) ? action[0] : action;
  return first === "signin" || first === "callback";
}

type AuthLimit = {
  bucket: "lookup" | "login" | "session";
  // Only routes that already promise to work without the console DB may use
  // the bounded per-process fallback during maintenance or a store outage.
  dbIndependent?: boolean;
  matches?: (req: NextApiRequest) => boolean;
  nextAuth?: boolean;
};

function rejectAuthRequest(
  req: NextApiRequest,
  res: NextApiResponse,
  spec: AuthLimit,
  status: 429 | 503,
  error: AuthRateLimitError
) {
  const body = { error, message: authRateLimitMessage(error) };
  if (!spec.nextAuth) return res.status(status).json(body);

  // next-auth/react parses data.url even for non-2xx responses. Use the
  // configured origin, never a caller-controlled Host or callbackUrl.
  const url = new URL("/signin", getPublicOrigin());
  url.searchParams.set("error", error);
  if (req.method === "POST" && (req.body?.json === true || req.body?.json === "true")) {
    return res.status(status).json({ ...body, url: url.toString() });
  }
  // Browser OAuth callbacks and direct form submissions need a page rather
  // than JSON. 303 also prevents replaying a credentials POST on /signin.
  return res.redirect(303, url.toString());
}

const fallback = new Map<string, { start: number; current: number; previous: number }>();
let lastWarning = 0;

function localCheck(opts: RateLimitOpts) {
  const now = Date.now();
  const start = Math.floor(now / WINDOW) * WINDOW;
  const key = `${opts.bucket}:${opts.principal}`;
  for (const [key, row] of fallback) {
    if (row.start < start - WINDOW) fallback.delete(key);
  }
  let row = fallback.get(key);
  if (!row) {
    // Do not evict active counters and give attackers a fresh budget.
    if (fallback.size >= 10_000) throw new Error("Auth fallback capacity exhausted");
    row = { start, current: 0, previous: 0 };
    fallback.set(key, row);
  } else if (row.start !== start) {
    row.previous = row.start === start - WINDOW ? row.current : 0;
    row.current = 0;
    row.start = start;
  }
  row.current++;
  return computeResult(opts, row.current, row.previous, now);
}

export function withAuthRateLimit(handler: NextApiHandler, spec: AuthLimit): NextApiHandler {
  return async (req, res) => {
    if (spec.matches && !spec.matches(req)) return handler(req, res);
    const env = getServerEnv();
    if (!env.MINUTE_RATE_LIMIT_ENABLED) return handler(req, res);
    const opts: RateLimitOpts = {
      authClass: "ip",
      principal: createHash("sha256").update(authClientIp(req)).digest("hex"),
      method: "POST", // one budget across HTTP methods and provider variants
      bucket: `auth-${spec.bucket}`,
      limit: spec.bucket === "session" ? env.AUTH_SESSION_RATE_LIMIT : env.AUTH_ATTEMPT_RATE_LIMIT,
      windowMs: WINDOW,
    };
    res.setHeader("Cache-Control", "no-store");
    try {
      let result;
      try {
        if (spec.dbIndependent && isReadOnly()) throw new Error("Database maintenance");
        result = await getRateLimiter().check(opts);
      } catch (error) {
        if (!spec.dbIndependent) throw error;
        if (Date.now() - lastWarning > WINDOW) {
          lastWarning = Date.now();
          log.atWarn().withCause(error).log("Auth limiter using per-process fallback for DB-independent endpoints");
        }
        result = localCheck(opts);
      }
      setRateLimitHeaders(res, result);
      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.retryAfterSec));
        rejectAuthRequest(req, res, spec, 429, "rate_limit_exceeded");
        return;
      }
    } catch (error) {
      log.atWarn().withCause(error).log("Authentication rate limiter unavailable");
      res.setHeader("Retry-After", "5");
      rejectAuthRequest(req, res, spec, 503, "rate_limiter_unavailable");
      return;
    }
    // Handler failures count too, and are never mistaken for limiter failures.
    return handler(req, res);
  };
}
