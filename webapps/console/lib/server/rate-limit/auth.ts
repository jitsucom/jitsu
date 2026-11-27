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

// Production ingress overwrites X-Real-IP, so it is trusted by default. A console that callers reach directly sets
// AUTH_TRUST_X_REAL_IP=false and is charged by the address of the connection instead. Never accept a caller-controlled
// X-Forwarded-For chain.
export function authClientIp(req: NextApiRequest): string {
  const header = getServerEnv().AUTH_TRUST_X_REAL_IP ? req.headers["x-real-ip"] : undefined;
  const candidate = typeof header === "string" && isIP(header) ? header : req.socket.remoteAddress ?? "unknown";
  // Node accepts an IPv6 zone identifier ("fe80::1%eth0", as a link-local connection address can carry); URL parsing does
  // not, and the zone names a local interface, not a client
  const ip = candidate.split("%")[0];
  if (isIP(ip) !== 6) return ip;
  let normalized: string;
  try {
    normalized = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  } catch {
    return ip;
  }
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
  // "token" is the OAuth token endpoint: its own budget, so that sign-in attempts and token requests of one address do not
  // use each other up
  bucket: "lookup" | "login" | "session" | "token";
  // Only routes that already promise to work without the console DB may use
  // the bounded per-process fallback during maintenance or a store outage.
  dbIndependent?: boolean;
  matches?: (req: NextApiRequest) => boolean;
  nextAuth?: boolean;
  // A deployment pinned read-only can share its database with production, so it must not count anything in it: no limit and
  // no counter row, which would otherwise spend the budget of the same address in production.
  skipInReadOnly?: boolean;
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

// Failed authentications of a route that serves many valid requests (the MCP endpoint): counting every request would throttle
// legitimate clients and write a counter row for each of their calls. Failures are counted once they have happened, per
// client address, and an address that has used up its budget is refused before anything is checked.
function failedAttemptOpts(req: NextApiRequest): RateLimitOpts | undefined {
  const env = getServerEnv();
  if (!env.MINUTE_RATE_LIMIT_ENABLED || isReadOnly()) return undefined;
  return {
    authClass: "ip",
    principal: createHash("sha256").update(authClientIp(req)).digest("hex"),
    method: "POST",
    bucket: "auth-failed-mcp",
    limit: env.AUTH_ATTEMPT_RATE_LIMIT,
    windowMs: WINDOW,
  };
}

// Checks of an address that are admitted and not yet counted. A burst of parallel requests would otherwise all read the same
// count before the first failure is recorded, and every one of them would reach the credential check. Each admitted check
// uses one unit of the budget until it has finished, so a burst can never get more checks through than the budget has room
// for. The map is per process: with several replicas each admits up to the budget on its own, which is still bounded.
const checksInFlight = new Map<string, number>();

export type AuthAttempt = {
  /** The credentials were wrong: counts one failure for this address. A store error is logged, the 401 is sent already. */
  recordFailure(): Promise<void>;
  /** The check is over, whatever its result. Call it exactly once, in a `finally`. */
  release(): void;
};

/**
 * Admits an authentication check of this request, or refuses it (429, or 503 when the counters cannot be read) and returns
 * undefined with the response sent already. An admitted check holds a place in the budget until `release()`.
 */
export async function beginAuthAttempt(req: NextApiRequest, res: NextApiResponse): Promise<AuthAttempt | undefined> {
  const opts = failedAttemptOpts(req);
  if (!opts) return { recordFailure: async () => {}, release: () => {} };
  const pending = checksInFlight.get(opts.principal) ?? 0;
  res.setHeader("Cache-Control", "no-store");
  if (pending >= opts.limit) {
    // The checks in flight fill the budget by themselves: whatever is recorded, this one cannot fit. Refuse it without
    // reserving a place or reading the counter, so a burst of requests without credentials does not queue on the database.
    res.setHeader("Retry-After", "1");
    rejectAuthRequest(req, res, { bucket: "login" }, 429, "rate_limit_exceeded");
    return undefined;
  }
  checksInFlight.set(opts.principal, pending + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const left = (checksInFlight.get(opts.principal) ?? 1) - 1;
    if (left > 0) checksInFlight.set(opts.principal, left);
    else checksInFlight.delete(opts.principal);
  };
  try {
    let counted = pending;
    let result = await getRateLimiter().peek(opts, counted);
    // The in-flight count was taken before the read. A check that ended since has recorded its failure before it let go of its
    // place, so the read may already contain it and the count would then hold it twice, and refuse a request that fits. Read
    // again with the current count, which drops only the checks that are over: it never counts less than what is there. Not
    // when the recorded failures use the budget up by themselves: the checks that end cannot change that, and a burst against
    // a blocked address would read the counter twice for each request.
    for (let again = 0; !result.allowed && !result.blockedByRecorded && again < 2; again++) {
      const others = (checksInFlight.get(opts.principal) ?? 1) - 1;
      if (others >= counted) break;
      counted = others;
      result = await getRateLimiter().peek(opts, counted);
    }
    if (result.allowed) {
      return {
        recordFailure: async () => {
          try {
            await getRateLimiter().check(opts);
          } catch (error) {
            log.atWarn().withCause(error).log("Could not record a failed authentication attempt");
          }
        },
        release,
      };
    }
    release();
    setRateLimitHeaders(res, result);
    res.setHeader("Retry-After", String(result.retryAfterSec));
    rejectAuthRequest(req, res, { bucket: "login" }, 429, "rate_limit_exceeded");
    return undefined;
  } catch (error) {
    release();
    log.atWarn().withCause(error).log("Authentication rate limiter unavailable");
    res.setHeader("Retry-After", "5");
    rejectAuthRequest(req, res, { bucket: "login" }, 503, "rate_limiter_unavailable");
    return undefined;
  }
}

export function withAuthRateLimit(handler: NextApiHandler, spec: AuthLimit): NextApiHandler {
  return async (req, res) => {
    if (spec.matches && !spec.matches(req)) return handler(req, res);
    const env = getServerEnv();
    if (!env.MINUTE_RATE_LIMIT_ENABLED) return handler(req, res);
    if (spec.skipInReadOnly && isReadOnly()) return handler(req, res);
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
