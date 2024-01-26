import { z } from "zod";
import { Simplify } from "type-fest";

export const KnownEventStatus = z.enum([
  "success",
  "dropped",
  "error",
  "processed",
  "function_success",
  "builtin_function_success",
  "builtin_function_error",
]);
export type KnownEventStatus = z.infer<typeof KnownEventStatus>;

const EventStatus = KnownEventStatus
  //don't fail if we have a new status
  .and(z.string());
export type EventStatus = z.infer<typeof EventStatus>;

export const ReportRow = z.object({
  // day as being the day in UTC
  period: z.coerce.date(),
  workspaceId: z.string(),
  connectionId: z.string(),
  streamId: z.string(),
  destinationId: z.string(),
  status: z.string(),
  events: z.coerce.number(),
  /**
   * Size (rows) of an underlying chunk, do not use in UI
   */
  srcSize: z.coerce.number(),
});

export type ReportRow = z.infer<typeof ReportRow>;

export const Report = z.object({
  rows: z.array(ReportRow),
});

export type Report = z.infer<typeof Report>;

export const AggregatedReportRow = ReportRow.omit({ events: true, srcSize: true }).and(
  z.object({
    events: z.record(EventStatus, z.number()),
  })
);

export type AggregatedReportRow = z.infer<typeof AggregatedReportRow>;

export const AggregatedReport = z.object({
  rows: z.array(AggregatedReportRow),
});

export type AggregatedReport = z.infer<typeof AggregatedReport>;

export function aggregateReport(report: Report): AggregatedReport {
  //We will need it for CSV export
  throw new Error("Not implemented");
}

export const ActiveEventsReportRow = z.object({
  period: z.coerce.date(),
  activeEvents: z.coerce.number(),
});
export type ActiveEventsReportRow = z.infer<typeof ActiveEventsReportRow>;
export const ActiveEventsReport = z.object({
  workspaceId: z.string(),
  //totals might be calculated differently than a sun of breakdown, because we take into account unique events
  totalActiveEvents: z.number(),
  breakdown: z.array(ActiveEventsReportRow),
});

export type ActiveEventsReport = z.infer<typeof ActiveEventsReport>;

const ConnectionStat = z
  .record(KnownEventStatus, z.number())
  .transform(x => x as typeof x extends Partial<infer T> ? T : never);
export type ConnectionStat = z.infer<typeof ConnectionStat>;

export const ConnectionAggregate = z.object({
  workspaceId: z.string(),
  connectionId: z.string(),
  breakdown: z.array(
    z
      .object({
        period: z.coerce.date(),
      })
      //see https://github.com/colinhacks/zod/issues/2623#issuecomment-1880845969. Otherwise it makes a partial record
      .and(ConnectionStat)
  ),
});

export type ConnectionAggregate = Simplify<z.infer<typeof ConnectionAggregate>>;

function getWorkspaceId(report: Report): string {
  if (report.rows.length === 0) {
    throw new Error("Report is empty");
  }
  const workspaceId = report.rows[0].workspaceId;

  const otherWorkspace = report.rows.find(row => row.workspaceId !== workspaceId);
  if (otherWorkspace) {
    throw new Error(`Report contains rows from multiple workspaces: ${workspaceId} and ${otherWorkspace.workspaceId}`);
  }
  return workspaceId;
}

function agg(rec1: Record<string, number>, rec2: Record<string, number>): Record<string, number> {
  const res = { ...rec1 };
  for (const [key, value] of Object.entries(rec2)) {
    res[key] = (res[key] || 0) + value;
  }
  return res;
}

export function buildConnectionAggregate(report: Report, connectionId: string): ConnectionAggregate {
  const rowsOfInterest = report.rows.filter(row => row.connectionId === connectionId);
  const preAgg = rowsOfInterest.reduce((byDay, row) => {
    byDay[row.period.toISOString()] = agg(
      byDay[row.period.toISOString()] || Object.fromEntries(KnownEventStatus.options.map(st => [st, 0])),
      { [row.status]: row.events }
    );
    return byDay;
  }, {} as Record<string, ConnectionStat>);
  return {
    workspaceId: getWorkspaceId(report),
    connectionId,
    breakdown: Object.entries(preAgg).map(([day, values]) => ({
      period: new Date(day),
      ...values,
    })),
  };
}
