import type { NextApiRequest, NextApiResponse } from "next";
import type { HttpMethodType } from "../../api";
import type { SessionUser } from "../../schema";
import { getServerEnv } from "../serverEnv";
import { resolveLimit, resolveWindowMs } from "./config";
import type { AuthClass, RateLimitOpts, RateLimitResult, RateLimiter, RouteRateLimitSpec } from "./types";

export type { AuthClass, RateLimitOpts, RateLimitResult, RateLimiter, RouteRateLimitSpec } from "./types";
export type { RouteRateLimitOverride } from "./types";

let _instance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!_instance) {
    // Lazy-import to keep Postgres / Prisma out of the module load graph for
    // unit tests that only exercise the in-memory limiter or pure helpers.
    const { PgRateLimiter } = require("./pg") as typeof import("./pg");
    _instance = new PgRateLimiter();
  }
  return _instance;
}

// Test-only DI override.
export function setRateLimiter(rl: RateLimiter): void {
  _instance = rl;
}

function classifyUser(user: SessionUser): { authClass: AuthClass; principal: string } | null {
  if (user.loginProvider === "admin/token") {
    return null;
  }
  if (user.authType === "bearer") {
    return { authClass: "bearer", principal: user.tokenId ?? user.internalId };
  }
  return { authClass: "session", principal: user.internalId };
}

export function getRateLimitOpts(
  _req: NextApiRequest,
  user: SessionUser | undefined,
  routeMeta: { method: HttpMethodType; rateLimit?: RouteRateLimitSpec }
): RateLimitOpts | null {
  if (!getServerEnv().MINUTE_RATE_LIMIT_ENABLED) return null;
  if (routeMeta.rateLimit === false) return null;
  if (!user) return null;
  const classified = classifyUser(user);
  if (!classified) return null;

  const override = routeMeta.rateLimit || undefined;
  const bucket = override?.bucket ?? routeMeta.method;
  const limit = resolveLimit(classified.authClass, routeMeta.method, override);
  const windowMs = resolveWindowMs(override);

  return {
    authClass: classified.authClass,
    principal: classified.principal,
    method: routeMeta.method,
    bucket,
    limit,
    windowMs,
  };
}

export function setRateLimitHeaders(res: NextApiResponse, r: RateLimitResult): void {
  res.setHeader("X-RateLimit-Limit", String(r.limit));
  res.setHeader("X-RateLimit-Remaining", String(r.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.floor(r.resetAt.getTime() / 1000)));
}
