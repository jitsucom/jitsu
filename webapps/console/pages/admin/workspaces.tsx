import { get } from "../../lib/useApi";
import { useRouter } from "next/router";
import { useQueryStringState } from "../../lib/useQueryStringState";
import { CircleDollarSign, Loader2, UserCircle2 } from "lucide-react";
import { ErrorCard } from "../../components/GlobalError/GlobalError";
import { Button, Switch } from "antd";
import omit from "lodash/omit";
import { useState } from "react";
import hash from "stable-hash";
import { JsonAsTable } from "../../components/JsonAsTable/JsonAsTable";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

const View = ({ data }) => {
  const [rollup, setRollup] = useState(false);
  const router = useRouter();
  const [loadingGoBack, setLoadingGoBack] = useState(false);
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
          users: { omit: true },
          events: { type: "number" },
          workspaceSlug: { omit: true },
          workspaceName: { type: "link", href: (val, row) => `/${row.workspaceSlug}` },
          billing: {
            type: "custom",
            render: (val, row) => {
              if (val?.planId === "enterprise") {
                return (
                  <Link key="status" href={`/${row.workspaceSlug}/settings/billing`} className="grow">
                    <div className="border text-center rounded-full text-xs text-orange-400 border-orange-400 bg-orange-400/10">
                      ENTERPRISE
                    </div>
                  </Link>
                );
              } else if (val?.renewAfterExpiration === true) {
                return (
                  <div className="flex flex-nowrap text-success items-center gap-1 text-sm">
                    <Link key="status" href={`/${row.workspaceSlug}/settings/billing`} className="grow">
                      <div className="border text-center rounded-full text-xs text-success border-success bg-success/10">
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
                  <UserCircle2 className="text-warning w-4 h-4 invisible" />
                  <CircleDollarSign className="text-warning w-4 h-4 invisible" />
                </div>
              );
            },
          },
        }}
      />
    </div>
  );
};

export const WorkspacesAdminPage = () => {
  const { data, isLoading, error } = useQuery(
    ["workspaces-admin"],
    async () => {
      return await Promise.all([
        get("/api/$all/ee/report/workspace-stat?extended=true"),
        get("/api/$all/ee/billing/workspaces"),
      ]);
    },
    { retry: false, cacheTime: 0 }
  );
  const router = useRouter();
  const [filter, setFilter] = useQueryStringState("filter");
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
  const [workspacesList, billing] = data!;
  const enrichedList = workspacesList.data.map(w => {
    if (billing[w.workspaceId]) {
      w.billing = billing[w.workspaceId];
    }
    return w;
  });
  console.log(enrichedList);
  return <View data={enrichedList} />;
};

export default WorkspacesAdminPage;
