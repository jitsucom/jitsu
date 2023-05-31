import { useQuery } from "@tanstack/react-query";
import { assertFalse, assertTrue, rpc } from "juava";
import { useWorkspace } from "../../lib/context";
import { useBilling } from "./BillingProvider";

export type Usage = {
  destinationEvents: number;
  maxAllowedDestinatonEvents: number;
  usagePercentage: number;
  periodStart: Date;
  periodEnd: Date;
};

export type UseUsageRes = { isLoading: boolean; error?: any; usage?: Usage };

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
      const report = await rpc(`/api/${workspace.id}/ee/report/destination-stat?start=${periodStart?.toISOString()}`);
      const warehouseUsage = report.data.reduce(
        (acc, d) => acc + (d.destination_type === "warehouse" ? d.events : 0),
        0
      );
      const destinationUsage = report.data.reduce(
        (acc, d) => acc + (d.destination_type === "warehouse" ? 0 : d.events),
        0
      );
      return { warehouseUsage, destinationUsage } as const;
    },
    { retry: false, cacheTime: 0 }
  );

  return {
    isLoading,
    error,
    usage: data
      ? {
          periodStart,
          periodEnd,
          destinationEvents: data.warehouseUsage + data.destinationUsage,
          maxAllowedDestinatonEvents: billing.settings.destinationEvensPerMonth,
          usagePercentage: (data.warehouseUsage + data.destinationUsage) / billing.settings.destinationEvensPerMonth,
        }
      : undefined,
  };
}
