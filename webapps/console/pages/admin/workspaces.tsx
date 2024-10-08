import { get } from "../../lib/useApi";
import { CirclePercent, CircleDollarSign, Loader2, ShieldAlert, UserCircle2, XOctagon } from "lucide-react";
import { ErrorCard } from "../../components/GlobalError/GlobalError";
import { Button, Switch, Tooltip } from "antd";
import omit from "lodash/omit";
import { useState } from "react";
import hash from "stable-hash";
import { JsonAsTable } from "../../components/JsonAsTable/JsonAsTable";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { WorkspaceDbModel } from "../../prisma/schema";
import { z } from "zod";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

function getThrottleVal(throttle: string) {
  return Number.parseInt(throttle.replaceAll("throttle", "").replace("=", ""));
}

const View = ({ data }) => {
  const [rollup, setRollup] = useState(false);
  return (
    <div className="p-12">
      <div className="flex justify-between mb-12">
        <div className="flex space-x-2 items-center">
          <Switch onClick={val => setRollup(val)} /> <label>Rollup</label>
        </div>
        <div>
          <Button size="large" type="link" href={"/admin/overage-billing"}>
            Go to Billing Admin
          </Button>
          <Button size="large" type="primary" href={"/"}>
            Back
          </Button>
        </div>
      </div>
      <JsonAsTable
        rows={(rollup
          ? Object.values(
              data.reduce((res, row) => {
                const rowKey = hash(omit(row, "events", "period"));
                const rowValues = omit(row, "period");
                if (!res[rowKey]) {
                  res[rowKey] = { ...rowValues, events: 0 };
                }
                res[rowKey].events += row.events;
                return res;
              }, {})
            )
          : data
        )
          .sort((a, b) => {
            const dateCompare = a.period && b.period ? -a.period.localeCompare(b.period) : 0;
            return dateCompare === 0 ? b.events - a.events : dateCompare;
          })
          .map(({ period, workspaceName, workspaceId, domains, workspaceSlug, events, ...rest }) => ({
            ...(period ? { period: new Date(period).toISOString().replace("T", " ") } : {}),
            ...{
              workspaceName: workspaceName || workspaceSlug || workspaceId,
              workspaceSlug: workspaceSlug || workspaceId,
              domains,
              ...rest,
              events,
            },
          }))}
        columnOptions={{
          src: { omit: true },
          workspaceId: { omit: true },
          usageAlerts: { omit: true },
          throttle: { omit: true },
          users: { omit: true },
          events: { type: "number" },
          workspaceSlug: { omit: true },
          domains: {
            type: "custom",
            render: val => {
              return (
                <div className="flex flex-col">
                  {(val || []).map(d => (
                    <Link className="text-xxs" key={d} href={`https://${d}`}>
                      {d}
                    </Link>
                  ))}
                </div>
              );
            },
          },
          workspaceName: { type: "link", href: (val, row) => `/${row.workspaceSlug}` },
          billing: {
            type: "custom",
            render: (val, row) => {
              if (val?.planId === "billing-disabled") {
                return (
                  <Link key="status" href={`/${row.workspaceSlug}/settings/billing`}>
                    <div className="border text-center rounded-xl px-2 text-xs text-zinc-200 border-zinc-200 bg-zinc-200/10">
                      DISABLED
                    </div>
                  </Link>
                );
              } else if (val?.planId === "enterprise") {
                return (
                  <Link key="status" href={`/${row.workspaceSlug}/settings/billing`} className="grow">
                    <div className="border text-center rounded-xl px-2 text-xs text-orange-400 border-orange-400 bg-orange-400/10">
                      ENTERPRISE
                    </div>
                  </Link>
                );
              } else if (val?.renewAfterExpiration === true) {
                return (
                  <div className="flex flex-nowrap text-success items-center gap-1 text-sm">
                    <Link key="status" href={`/${row.workspaceSlug}/settings/billing`} className="grow">
                      <div className="border text-center rounded-xl px-2 text-xs text-success border-success bg-success/10">
                        PAYING
                      </div>
                    </Link>
                    <Link key="customer" href={val.customerLink}>
                      <UserCircle2 className="text-success w-4 h-4" />
                    </Link>
                    <Link href={val.subscriptionLink}>
                      <CircleDollarSign className="text-success w-4 h-4" />
                    </Link>
                  </div>
                );
              } else if (val?.renewAfterExpiration === false) {
                return (
                  <div className="flex flex-nowrap text-warning items-center gap-1 text-sm">
                    <Link key="status" href={`/${row.workspaceSlug}/settings/billing`} className="grow">
                      <div className="border text-center rounded-full text-xs text-warning border-warning bg-warning/10">
                        CANCELLING
                      </div>
                    </Link>
                    <Link key="customer" href={val.customerLink}>
                      <UserCircle2 className="text-warning w-4 h-4" />
                    </Link>
                    <Link href={val.subscriptionLink}>
                      <CircleDollarSign className="text-warning w-4 h-4" />
                    </Link>
                  </div>
                );
              }
              return (
                <div className="flex flex-nowrap text-textLight items-center gap-1 text-sm">
                  <Link key="status" href={`/${row.workspaceSlug}/settings/billing`} className="grow">
                    <div className="border text-center rounded-full text-xs text-textLight border-textLight bg-textLight/10">
                      FREE
                    </div>
                  </Link>
                  {row.usageAlerts?.willExceed ? (
                    <Link href={`/${row.workspaceSlug}/settings/billing`}>
                      <Tooltip title="Quota is projected to exceed">
                        <ShieldAlert className="text-warning w-4 h-4 " />
                      </Tooltip>
                    </Link>
                  ) : row.usageAlerts?.exceeded ? (
                    <Link href={`/${row.workspaceSlug}/settings/billing`}>
                      <Tooltip title="Quota exceeded">
                        <XOctagon className="text-error w-4 h-4 " />
                      </Tooltip>
                    </Link>
                  ) : (
                    <XOctagon className="text-warning w-4 h-4 invisible " />
                  )}
                  {row.throttle ? (
                    <Link href={`/${row.workspaceSlug}/settings/billing`}>
                      <Tooltip title={`Request throttled at ${getThrottleVal(row.throttle)}%`}>
                        <CirclePercent className="text-primary w-4 h-4 " />
                      </Tooltip>
                    </Link>
                  ) : (
                    <XOctagon className="text-warning w-4 h-4 invisible " />
                  )}
                </div>
              );
            },
          },
        }}
      />
    </div>
  );
};

export type ReportRow = {
  workspaceId: string;
  period: string;
  events: number;
  workspaceName: string;
  workspaceSlug: string;
  [key: string]: any;
};

function getAlerts(data: ReportRow[], workspaceId: string) {
  const monthStart = dayjs().utc().startOf("month");
  const totalEvents = data
    .filter(r => r.workspaceId === workspaceId && !dayjs(r.period).isBefore(monthStart))
    .reduce((acc, r) => acc + r.events, 0);
  const yesterday = dayjs().utc().add(-1, "day").startOf("day");
  const yesterdayEvents = data
    .filter(r => r.workspaceId === workspaceId && dayjs(r.period).utc().startOf("day").isSame(yesterday))
    .reduce((acc, r) => acc + r.events, 0);
  const daysLeft = dayjs().utc().daysInMonth() - dayjs().utc().date();
  const projectedEvents = totalEvents + yesterdayEvents * daysLeft;
  if (totalEvents > 200000) {
    return { exceeded: true };
  } else if (projectedEvents > 200000) {
    return { willExceed: true }; //, projectedEvents, yesterdayEvents, totalEvents, daysLeft };
  }
}

export const WorkspacesAdminPage = () => {
  const { data, isLoading, error } = useQuery(
    ["workspaces-admin"],
    async ({ signal }) => {
      console.log("Fetching workspaces admin data");
      const [report, billing, workspaceList] = await Promise.all([
        get("/api/$all/ee/report/workspace-stat?extended=true", { signal }) as Promise<{ data: ReportRow[] }>,
        get("/api/$all/ee/billing/workspaces", { signal }) as Promise<Record<string, any>>,
        get("/api/workspace", { signal }) as Promise<z.infer<typeof WorkspaceDbModel>[]>,
      ]);
      const workspaceDict = workspaceList.reduce((acc, w) => {
        acc[w.id] = w;
        return acc;
      }, {});
      const joinedData: Record<string, ReportRow> = {};
      const days = [...new Set(report.data.map(w => w.period.split("T")[0]))].sort();
      const usageAlertsCache = {};
      console.log(`Populating usage from days ${days.length} days X ${Object.keys(billing).length} workspaces`);
      for (const day of days) {
        for (const [workspaceId, billingEntry] of Object.entries(billing)) {
          const workspace = workspaceDict[workspaceId];
          joinedData[`${day.split("T")[0]}/${workspaceId}`] = {
            period: day,
            workspaceId: workspaceId,
            workspaceName: workspace.name,
            billing: billingEntry,
            workspaceSlug: workspace.slug,
            events: 0,
            syncs: 0,
          };
        }
      }
      console.log(`Populating usage from days ${report.data.length} rows`);
      for (const row of report.data) {
        const billingEntry = billing[row.workspaceId];
        joinedData[`${row.period.split("T")[0]}/${row.workspaceId}`] = {
          ...row,
          billing: billingEntry,
          usageAlerts: billingEntry
            ? undefined
            : usageAlertsCache[row.workspaceId] ||
              (usageAlertsCache[row.workspaceId] = getAlerts(report.data, row.workspaceId)),
        };
      }
      return Object.values(joinedData);
    },
    { retry: false, cacheTime: 0 }
  );
  if (isLoading) {
    return (
      <div className="w-full h-full flex justify-center items-center">
        <Loader2 className="h-16 w-16 animate-spin" />
      </div>
    );
  } else if (error) {
    return (
      <div className="w-full h-full flex justify-center items-center">
        <ErrorCard error={error} />
      </div>
    );
  }
  return <View data={data!} />;
};

export default WorkspacesAdminPage;
