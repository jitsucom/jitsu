import { useQuery } from "@tanstack/react-query";
import { assertFalse, assertTrue, rpc } from "juava";
import { useUser, useWorkspace } from "../../lib/context";
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

export type UseUsageRes = { isLoading: boolean; error?: any; throttle?: number; usage?: Usage };

export type DestinationReportDataRow = {};

function parseThrottle(val: string): number | undefined {
  const match = val.match(/throttle=?(\d+)/);
  if (match) {
    return parseFloat(match[1]);
  }
}

/**
 * @param opts.skipSubscribed - if true, will return bogus data if workspace is subscribed to a paid
 * plan. In some cases, we don't really need usage for subscribed workspaces
 */
export function useEventsUsage(opts?: { skipSubscribed?: boolean; cacheSeconds?: number }): UseUsageRes {
  const workspace = useWorkspace();
  const billing = useBilling();
  assertTrue(billing.enabled, "Billing is not enabled");
  assertFalse(billing.loading, "Billing must be loaded before using usage hook");
  const cacheSeconds = opts?.cacheSeconds ?? 60 * 5; //5 minutes by default
  const throttle = workspace.featuresEnabled
    ?.filter(f => f.startsWith("throttle"))
    ?.map(parseThrottle)
    ?.find(t => t);

  let periodStart: Date;
  let periodEnd: Date;
  if (billing.settings?.currentPeriod) {
    periodEnd = new Date(billing.settings?.currentPeriod.end);
    periodStart = new Date(billing.settings?.currentPeriod.start);
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
    throttle,
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

export type ConsolidatedUsage = Usage & {
  /** Active syncs across the billing group over the period. */
  syncs: number;
  /** Workspaces summed — 1 for a standalone workspace, >1 for a billing parent. */
  memberCount: number;
};

export type UseConsolidatedUsageRes = {
  isLoading: boolean;
  error?: any;
  throttle?: number;
  usage?: ConsolidatedUsage;
};

/**
 * Usage for the billing page. Reads consolidated events + syncs for the whole
 * billing group from `/ee/billing/settings?withUsage=true` — for a billing
 * parent that sums the parent and all its children; for a standalone workspace
 * it is just that workspace.
 */
export function useConsolidatedUsage(): UseConsolidatedUsageRes {
  const workspace = useWorkspace();
  const user = useUser();
  const billing = useBilling();
  assertTrue(billing.enabled, "Billing is not enabled");
  assertFalse(billing.loading, "Billing must be loaded before using usage hook");

  const throttle = workspace.featuresEnabled
    ?.filter(f => f.startsWith("throttle"))
    ?.map(parseThrottle)
    ?.find(t => t);

  const { isLoading, error, data } = useQuery(
    ["consolidated usage", workspace.id, billing.settings.planId],
    async () => {
      const resp = await rpc(
        `/api/${workspace.id}/ee/billing/settings?withUsage=true&email=${encodeURIComponent(user.email)}`
      );
      return resp.usage as {
        events: number;
        syncs: number;
        periodStart: string;
        periodEnd: string;
        memberCount: number;
      };
    },
    { retry: false, cacheTime: 5 * 60 * 1000, staleTime: 5 * 60 * 1000 }
  );

  let usage: ConsolidatedUsage | undefined;
  if (data) {
    const periodStart = new Date(data.periodStart);
    const periodEnd = new Date(data.periodEnd);
    const periodDuration = dayjs(new Date()).diff(dayjs(periodStart), "day");
    const projection =
      periodDuration > 0
        ? (data.events / periodDuration) * dayjs(periodEnd).diff(dayjs(periodStart), "day")
        : undefined;
    usage = {
      periodStart,
      periodEnd,
      events: data.events,
      syncs: data.syncs,
      memberCount: data.memberCount,
      projectionByTheEndOfPeriod: projection,
      maxAllowedDestinatonEvents: billing.settings.destinationEvensPerMonth,
      usagePercentage: data.events / billing.settings.destinationEvensPerMonth,
    };
  }
  return { isLoading, error, throttle, usage };
}
