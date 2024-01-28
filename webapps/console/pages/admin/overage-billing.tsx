import { useApi } from "../../lib/useApi";
import { useRouter } from "next/router";
import { ExternalLink } from "lucide-react";
import { ErrorCard } from "../../components/GlobalError/GlobalError";
import { ColumnOption, JsonAsTable } from "../../components/JsonAsTable/JsonAsTable";
import { z } from "zod";
import { WorkspaceDbModel } from "../../prisma/schema";
import Link from "next/link";
import { Button, Progress } from "antd";
import { useEffect, useState } from "react";

function Reference(props: { children: React.ReactNode; href: string }) {
  return (
    <Link className="inline-flex items-center space-x-2 font-xs" href={props.href}>
      <span>{props.children}</span>
      <ExternalLink className="w-3" />
    </Link>
  );
}

const dateFormat: ColumnOption = {
  type: "custom",
  render: val => {
    const date = new Date(val);

    const dayMonthFormatter = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short" });
    const yearFormatter = new Intl.DateTimeFormat("en-US", { year: "2-digit" });

    const dayMonth = dayMonthFormatter.format(date);
    const year = yearFormatter.format(date);

    return (
      <div className={`tabular-nums ${Date.now() > date.getTime() ? "text-neutral-400" : ""}`}>
        {dayMonth}, {year}
      </div>
    );
  },
};

const View = ({ data, workspaces }) => {
  const router = useRouter();
  const workspacesMap = workspaces.reduce(
    (acc, w) => ({
      ...acc,
      [w.id]: w,
    }),
    {}
  );
  console.log("workspacesMap", workspacesMap);
  return (
    <div className="p-12">
      <div className="flex justify-between mb-12">
        <div className="flex space-x-2 items-center"></div>
        <div>
          <Button size="large" type="link" href={"/admin/workspaces"}>
            Go to Workspace Admin
          </Button>
          <Button size="large" type="primary" href={"/"}>
            Back
          </Button>
        </div>{" "}
      </div>
      <JsonAsTable
        rows={data.sort((a, b) => {
          {
            const dateCompare = -new Date(a.month).getTime() + new Date(b.month).getTime();
            return dateCompare === 0 ? -a.overageEvents + b.overageEvents : dateCompare;
          }
        })}
        columnOptions={{
          baseInvoiceId: { omit: true },
          quota: { omit: true },
          workspaceId: {
            type: "custom",
            render: workspaceId => {
              const name = workspacesMap[workspaceId]?.name || workspacesMap[workspaceId]?.slug || workspaceId;
              return <Reference href={`/${workspacesMap[workspaceId]?.slug || workspaceId}`}>{name}</Reference>;
            },
          },
          stripeCustomerId: {
            type: "custom",
            render: (customerId, { subscriptionId }) => {
              return (
                <div className="text-sm">
                  <Link href={`https://dashboard.stripe.com/customers/${customerId}`}>{customerId}</Link>
                  <br />
                  <Link href={`https://dashboard.stripe.com/subscriptions/${subscriptionId}`}>{subscriptionId}</Link>
                </div>
              );
            },
          },
          subscriptionId: { omit: true },
          start: dateFormat,
          roundedPeriod: { omit: true },
          end: dateFormat,
          destinationEvents: { type: "number" },
          overageEvents: { type: "number" },
          overageFee: { omit: true },
          baseFee: { type: "currency" },
          overageFeeFinal: { type: "currency" },
          projectedOverageFeeFinal: { type: "currency", title: "Projection" },
          discountPercentage: { omit: true },
          coupon: { omit: true },
          couponName: { omit: true },
          invoiceHelper: { omit: true },
          workspaceSlug: { omit: true },
          projectedEvents: { omit: true },
          workspaceName: { type: "link", href: (val, row) => `/${row.workspaceSlug}` },
        }}
      />
    </div>
  );
};

export const FakeProgressBar: React.FC<{ durationSeconds: number }> = ({ durationSeconds }) => {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const started = Date.now() / 1000;
    const interval = setInterval(() => {
      if (Math.random() < 0.8) {
        setProgress(Math.round(((Date.now() / 1000 - started) / durationSeconds) * 100));
      }
    }, (durationSeconds * 1000) / 100);
    return () => clearInterval(interval);
  }, [durationSeconds]);
  return <Progress type="circle" percent={progress} size="default" />;
};

export const OverageBillingPage = () => {
  const { data, isLoading, error } = useApi(`/api/$all/ee/report/overage`);
  const workspacesLoader = useApi<z.infer<typeof WorkspaceDbModel>[]>(`/api/workspace`);
  if (isLoading || workspacesLoader.isLoading) {
    return (
      <div className="w-full h-full flex justify-center items-center">
        <div className="flex flex-col justify-center items-center">
          {/*<Loader2 className="h-16 w-16 animate-spin" />*/}
          <FakeProgressBar durationSeconds={60} />
          <div className="text-center text-textLight text-sm">
            Building report. Hang tight, it could take up to a few minutes...
          </div>
        </div>
      </div>
    );
  } else if (error || workspacesLoader.error) {
    return (
      <div className="w-full h-full flex justify-center items-center">
        <ErrorCard error={error || workspacesLoader.error} />
      </div>
    );
  }
  return <View data={data.result} workspaces={workspacesLoader.data} />;
};

export default OverageBillingPage;
