import { Prisma, PrismaClient } from "@prisma/client";
import { getServerLog } from "../log";
import { SlidingWindowRateLimiter, type CounterWindow } from "juava/src/rate-limit";
import type { RateLimitOpts, RateLimitResult, RateLimiter } from "./types";

const log = getServerLog("rate-limit");

type Row = { current_count: number; prev_count: number };

export interface PgRateLimiterDeps {
  prisma: PrismaClient;
}

export class PgRateLimiter implements RateLimiter {
  private readonly prisma: PrismaClient;
  private readonly limiter: SlidingWindowRateLimiter;

  constructor(deps: PgRateLimiterDeps) {
    this.prisma = deps.prisma;
    this.limiter = new SlidingWindowRateLimiter(
      {
        increment: window => this.increment(window),
        cleanup: () => this.cleanup(),
      },
      error => log.atWarn().withCause(error).log("rate-limit cleanup failed")
    );
  }

  async check(opts: RateLimitOpts): Promise<RateLimitResult> {
    return this.limiter.check({ ...opts, key: `${opts.authClass}:${opts.principal}:${opts.bucket}` });
  }

  private async increment({ key, windowStart, previousWindowStart, expiresAt }: CounterWindow) {
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      WITH upserted AS (
        INSERT INTO newjitsu."RateLimitCounter" ("bucketKey", "windowStart", "count", "expiresAt")
        VALUES (${key}, ${windowStart}, 1, ${expiresAt})
        ON CONFLICT ("bucketKey", "windowStart")
        DO UPDATE SET "count" = newjitsu."RateLimitCounter"."count" + 1,
          "expiresAt" = GREATEST(newjitsu."RateLimitCounter"."expiresAt", EXCLUDED."expiresAt")
        RETURNING "count" AS current_count
      )
      SELECT
        (SELECT current_count FROM upserted)::int AS current_count,
        COALESCE(
          (SELECT "count" FROM newjitsu."RateLimitCounter"
             WHERE "bucketKey" = ${key} AND "windowStart" = ${previousWindowStart}),
          0
        )::int AS prev_count
    `);

    if (!rows[0]) throw new Error("Rate-limit counter increment returned no row");
    return { current: rows[0].current_count, previous: rows[0].prev_count };
  }

  private async cleanup(): Promise<void> {
    await this.prisma.$executeRaw`DELETE FROM newjitsu."RateLimitCounter" WHERE "expiresAt" < now()`;
  }
}
