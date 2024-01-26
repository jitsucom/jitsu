import { useQuery } from "@tanstack/react-query";
import { assertFalse, assertTrue, rpc } from "juava";
import { useWorkspace } from "../../lib/context";
import { useBilling } from "./BillingProvider";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { ActiveEventsReport } from "../../lib/shared/reporting";
dayjs.extend(utc);

export type Usage = {
  events: number;
  projectionByTheEndOfPeriod?: number;
  maxAllowedDestinatonEvents: number;
  usagePercentage: number;
  periodStart: Date;
  periodEnd: Date;
};

export type UseUsageRes = { isLoading: boolean; error?: any; usage?: Usage };

export type DestinationReportDataRow = {};

/**
 * @param opts.skipSubscribed - if true, will return bogus data if workspace is subscribed to a paid
 * plan. In some cases, we don't really need usage for subscribed workspaces
 */
export function useUsage(opts?: { skipSubscribed?: boolean; cacheSeconds?: number }): UseUsageRes {
  const workspace = useWorkspace();
  const billing = useBilling();
  assertTrue(billing.enabled, "Billing is not enabled");
  assertFalse(billing.loading, "Billing must be loaded before using usage hook");
  const cacheSeconds = opts?.cacheSeconds ?? 60 * 5; //5 minutes by default

  let periodStart: Date;
  let periodEnd: Date;
  if (billing.settings.expiresAt) {
    periodEnd = dayjs(billing.settings.expiresAt).utc().startOf("day").add(-1, "millisecond").toDate();
    periodStart = dayjs(billing.settings.expiresAt).utc().add(-1, "month").startOf("day").toDate();
  } else {
    periodStart = dayjs().utc().startOf("month").toDate();
    periodEnd = dayjs().utc().endOf("month").add(-1, "millisecond").toDate();
  }

  const { isLoading, error, data } = useQuery(
    ["billing usage", workspace.id, opts?.skipSubscribed, billing.settings.planId],
    async () => {
      if (opts?.skipSubscribed && billing.settings.planId !== "free") {
        //if workspace is subscribed to a paid plan - we don't really need usage in some cases
        return { usage: 0 };
      }
      const report = (await rpc(
        `/api/${workspace.id}/reports/active-events?start=${periodStart.toISOString()}&end=${dayjs(periodEnd)
          .subtract(1, "millisecond")
          .toISOString()}`
      )) as ActiveEventsReport;
      const usage = report.totalActiveEvents;
      return { usage } as const;
    },
    { retry: false, cacheTime: cacheSeconds * 1000, staleTime: cacheSeconds * 1000 }
  );

  const periodDuration = dayjs(new Date()).diff(dayjs(periodStart), "day");
  const projection =
    periodDuration > 0 && data
      ? (data.usage / periodDuration) * dayjs(periodEnd).diff(dayjs(periodStart), "day")
      : undefined;
  return {
    isLoading,
    error,
    usage: data
      ? {
          periodStart,
          periodEnd,
          events: data.usage,
          projectionByTheEndOfPeriod: projection,
          maxAllowedDestinatonEvents: billing.settings.destinationEvensPerMonth,
          usagePercentage: data.usage / billing.settings.destinationEvensPerMonth,
        }
      : undefined,
  };
}
