import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { auth } from "../../lib/auth";
import { getLog } from "juava";
import { getEventsReport, WorkspaceReportRow } from "./report/workspace-stat";
import { prisma } from "../../lib/services";

dayjs.extend(utc);

const log = getLog();

/** Number of periods a `full` rebuild covers, including the current one. */
const fullRebuildPeriods = 12;

export type SyncCacheGranularity = "month" | "day";

export type SyncCacheOptions = {
  granularity?: SyncCacheGranularity;
  /** When true, rebuild the last 12 months; otherwise refresh only the current period. */
  full?: boolean;
};

/** Progress events streamed by {@link syncStatCache} as it refreshes the cache. */
export type SyncCacheProgress =
  | { type: "start"; total: number; from: string; to: string }
  | { type: "period"; index: number; total: number; start: string; end: string; rows: number; ms: number }
  | { type: "done"; total: number; ms: number };

/** Rows per upsert statement — keeps the placeholder and parameter count bounded. */
const upsertChunkSize = 1000;

async function upsertStatCache(report: WorkspaceReportRow[]): Promise<void> {
  for (let i = 0; i < report.length; i += upsertChunkSize) {
    const batch = report.slice(i, i + upsertChunkSize);
    // Positional placeholders via $executeRawUnsafe. `Prisma.sql` / `Prisma.join`
    // fragments passed to $executeRaw break under Next.js HMR — the `Sql` instances
    // stop being recognized across reloads and the query collapses to `values $1`.
    // The SQL here is fully static (only the row count varies), so it is not unsafe.
    //
    // `period` is an ISO string cast to timestamp — the column is `timestamp without
    // time zone`, and the cast drops the `Z` rather than converting, so it stays
    // session-timezone independent.
    const tuples = batch
      .map((_, j) => {
        const p = j * 4;
        return `($${p + 1}, $${p + 2}::timestamp, $${p + 3}, $${p + 4})`;
      })
      .join(", ");
    const values = batch.flatMap(({ workspaceId, period, events, syncs }) => [workspaceId, period, events, syncs || 0]);
    await prisma.$executeRawUnsafe(
      `insert into newjitsuee.stat_cache ("workspaceId", "period", "events", "syncs")
       values ${tuples}
       on conflict ("workspaceId", "period")
       do update set "events" = excluded."events", "syncs" = excluded."syncs"`,
      ...values
    );
  }
}

/**
 * Refresh `newjitsuee.stat_cache` from ClickHouse one period at a time, yielding a
 * progress event after each. `full` rebuilds the last 12 months; otherwise only the
 * current period is refreshed (plus the previous one on the 1st of the month, so the
 * just-closed period gets a final pass).
 */
export async function* syncStatCache({
  granularity = "month",
  full = false,
}: SyncCacheOptions): AsyncGenerator<SyncCacheProgress> {
  const now = dayjs().utc();
  // The loop below is inclusive of both bounds, so subtract one less than the
  // period count to land on exactly `fullRebuildPeriods` periods.
  const min = full
    ? now.startOf(granularity).subtract(fullRebuildPeriods - 1, granularity)
    : now.date() > 1
    ? now.startOf(granularity)
    : now.startOf(granularity).subtract(1, granularity);
  // Period starts, newest first.
  const periods: dayjs.Dayjs[] = [];
  for (let cur = now.startOf(granularity); cur.isAfter(min) || cur.isSame(min); ) {
    periods.push(cur);
    cur = cur.subtract(1, granularity).startOf(granularity);
  }
  const overallTimer = Date.now();
  log.atInfo().log(`Starting stat_cache sync from ${min.toISOString()} — ${periods.length} period(s)`);
  yield { type: "start", total: periods.length, from: min.toISOString(), to: now.startOf(granularity).toISOString() };
  for (let index = 0; index < periods.length; index++) {
    const start = periods[index];
    const end = start.add(1, granularity);
    const timer = Date.now();
    log.atInfo().log(`Building report for [${start.toISOString()}, ${end.toISOString()}]`);
    const report = await getEventsReport({ start: start.toISOString(), end: end.toISOString(), granularity: "day" });
    await upsertStatCache(report);
    const ms = Date.now() - timer;
    log.atInfo().log(`Cached [${start.toISOString()}, ${end.toISOString()}] in ${ms}ms. Rows: ${report.length}`);
    yield {
      type: "period",
      index,
      total: periods.length,
      start: start.toISOString(),
      end: end.toISOString(),
      rows: report.length,
      ms,
    };
  }
  yield { type: "done", total: periods.length, ms: Date.now() - overallTimer };
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const claims = await auth(req, res);
  if (claims?.type !== "admin") {
    throw new Error("Unauthorized");
  }
  const granularity: SyncCacheGranularity = req.query.granularity === "day" ? "day" : "month";
  const full = req.query.full === "true" || req.query.full === "1";
  const logResult: Record<string, any> = {};
  for await (const event of syncStatCache({ granularity, full })) {
    if (event.type === "period") {
      logResult[event.start] = { start: event.start, end: event.end, rows: event.rows, ms: event.ms };
    }
  }
  res.json({ ok: true, log: logResult });
};

export const config = {
  maxDuration: 300,
};

export default withErrorHandler(handler);
