import { Prisma } from "@prisma/client";
import { db } from "../db";
import { getServerLog } from "../log";
import { computeResult } from "./compute";
import type { RateLimitOpts, RateLimitResult, RateLimiter } from "./types";

const log = getServerLog("rate-limit");

const CLEANUP_PROB = 1 / 500;

type Row = { current_count: number; prev_count: number };

export class PgRateLimiter implements RateLimiter {
  async check(opts: RateLimitOpts): Promise<RateLimitResult> {
    const key = `${opts.authClass}:${opts.principal}:${opts.bucket}`;
    const now = Date.now();
    const windowStartMs = Math.floor(now / opts.windowMs) * opts.windowMs;
    const windowStart = new Date(windowStartMs);
    const prevWindowStart = new Date(windowStartMs - opts.windowMs);
    const expiresAt = new Date(windowStartMs + opts.windowMs + 5 * 60_000);

    const rows = await db.prisma().$queryRaw<Row[]>(Prisma.sql`
      WITH upserted AS (
        INSERT INTO newjitsu."RateLimitCounter" ("bucketKey", "windowStart", "count", "expiresAt")
        VALUES (${key}, ${windowStart}, 1, ${expiresAt})
        ON CONFLICT ("bucketKey", "windowStart")
        DO UPDATE SET "count" = newjitsu."RateLimitCounter"."count" + 1
        RETURNING "count" AS current_count
      )
      SELECT
        (SELECT current_count FROM upserted)::int AS current_count,
        COALESCE(
          (SELECT "count" FROM newjitsu."RateLimitCounter"
             WHERE "bucketKey" = ${key} AND "windowStart" = ${prevWindowStart}),
          0
        )::int AS prev_count
    `);

    const { current_count: current, prev_count: previous } = rows[0] ?? { current_count: 1, prev_count: 0 };

    if (Math.random() < CLEANUP_PROB) {
      this.cleanup().catch(e => log.atWarn().withCause(e).log("rate-limit cleanup failed"));
    }

    return computeResult(opts, current, previous, now);
  }

  private async cleanup(): Promise<void> {
    await db.prisma().$executeRaw`DELETE FROM newjitsu."RateLimitCounter" WHERE "expiresAt" < now()`;
  }
}
