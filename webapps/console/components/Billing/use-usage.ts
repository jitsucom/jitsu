import { useQuery } from "@tanstack/react-query";
import { assertFalse, assertTrue, rpc } from "juava";
import { useWorkspace } from "../../lib/context";
import { useBilling } from "./BillingProvider";
import dayjs from "dayjs";

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

export function useUsage(): UseUsageRes {
  const workspace = useWorkspace();
  const billing = useBilling();
  assertTrue(billing.enabled, "Billing is not enabled");
  assertFalse(billing.loading, "Billing must be loaded before using usage hook");

  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;
  if (billing.settings.expiresAt) {
    periodEnd = new Date(billing.settings.expiresAt);
    periodStart = new Date(billing.settings.expiresAt);
    periodStart.setMonth(periodStart.getMonth() - 1);
  } else {
    periodStart = new Date();
    periodStart.setDate(1);
    periodEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
  }

  const { isLoading, error, data } = useQuery(
    ["billing usage", workspace.id],
    async () => {
      const report = await rpc(`/api/${workspace.id}/ee/report/workspace-stat?start=${periodStart?.toISOString()}`);
      const usage = report.data.reduce((acc, d) => acc + d.events, 0);
      return { usage } as const;
    },
    { retry: false, cacheTime: 0 }
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
