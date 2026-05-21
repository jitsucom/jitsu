import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import dayjs from "dayjs";
import { auth } from "../../lib/auth";
import { getLog } from "juava";
import { getEventsReport } from "./report/workspace-stat";
import { prisma, Prisma } from "../../lib/services";

const log = getLog();

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const claims = await auth(req, res);
  if (claims?.type !== "admin") {
    throw new Error("Unauthorized");
  }
  const logResult: Record<string, any> = {};
  const granularity = ((req.query.granularity as string) || "month") as "month" | "day";
  const full = req.query.full === "true" || req.query.full === "1";
  const now = dayjs().utc();
  let startOfCurrentPeriod = now.startOf(granularity);
  const lookbackMonths = 12;
  const min = full
    ? now.startOf(granularity).subtract(lookbackMonths, "month")
    : now.get("day") > 1
    ? now.startOf(granularity)
    : now.startOf(granularity).subtract(1, granularity);
  log.atInfo().log(`Starting cache sync from ${min.toISOString()} to ${startOfCurrentPeriod.toISOString()}`);
  while (startOfCurrentPeriod.isAfter(min) || startOfCurrentPeriod.isSame(min)) {
    const start = startOfCurrentPeriod;
    const end = startOfCurrentPeriod.add(1, granularity);
    const timer = Date.now();
    log.atInfo().log(`Building report for [${start.toISOString()}, ${end.toISOString()}]`);
    const report = await getEventsReport({ start: start.toISOString(), end: end.toISOString(), granularity: "day" });
    const ellapsed = Date.now() - timer;
    log
      .atInfo()
      .log(
        `Built report for [${start.toISOString()}, ${end.toISOString()}] in ${ellapsed}ms. Rows: ${
          report.length
        } Adding data to cache`
      );
    if (report.length > 0) {
      const rows = report.map(
        ({ workspaceId, period, events, syncs }) => Prisma.sql`(${workspaceId}, ${period}, ${events}, ${syncs || 0})`
      );
      log.atDebug().log(`Running batch upsert for ${rows.length} rows`);
      await prisma.$executeRaw`
        insert into newjitsuee.stat_cache ("workspaceId", "period", "events", "syncs")
        values ${Prisma.join(rows)}
        on conflict ("workspaceId", "period")
        do update set "events" = excluded."events", "syncs" = excluded."syncs"`;
    }
    logResult[start.toISOString()] = {
      start: start.toISOString(),
      end: end.toISOString(),
      ms: Date.now() - timer,
    };
    startOfCurrentPeriod = startOfCurrentPeriod.subtract(1, granularity).startOf(granularity);
  }
  res.json({ ok: true, log: logResult });
};

export default withErrorHandler(handler);
