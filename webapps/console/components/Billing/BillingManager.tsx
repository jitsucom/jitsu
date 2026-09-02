import React, { ReactNode } from "react";
import { useBilling } from "./BillingProvider";
import { BannerCard } from "./BillingBanners";
import { useAppConfig, useUser, useWorkspace } from "../../lib/context";
import { useEeApi, useEeRedirect } from "../../lib/eeApi";
import { assertDefined, assertFalse, assertTrue, requireDefined, rpc } from "juava";
import { BillingSettings } from "../../lib/schema";
import { Alert, Button, Progress, Skeleton, Tooltip } from "antd";
import Link from "next/link";
import { Check, ChevronRight, Edit2, Info, XCircle } from "lucide-react";

import styles from "./BillingManager.module.css";
import { useQuery } from "@tanstack/react-query";
import { ErrorCard } from "../GlobalError/GlobalError";
import { useEventsUsage } from "./use-events-usage";
import { billingPeriod, syncQuotaWindow } from "./billing-period";
import { JitsuButton } from "../JitsuButton/JitsuButton";
import dayjs from "dayjs";

function formatNumber(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export type BillingState = {
  plans: Record<
    string,
    BillingSettings & {
      name: string;
      monthlyPrice: number;
      annualPrice?: number;
      disabled?: boolean;
    }
  >;
};

const ComparisonSection: React.FC<{
  header: ReactNode;
  info?: ReactNode;
  items: (string | { header: string; enabled: boolean })[];
}> = ({ header, items, info }) => {
  return (
    <div className={styles.comparisonSection}>
      <h5 key="credits">
        <span>{header}</span>
        {info && (
          <Tooltip title={info}>
            <Info className="h-3 2-3"></Info>
          </Tooltip>
        )}
      </h5>
      <ul>
        {items.map(item => (
          <li key={typeof item === "string" ? item : item.header}>
            {typeof item === "string" || item.enabled ? <Check className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            <span>{typeof item === "string" ? item : item.header}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const EventsUsageSection: React.FC<{}> = () => {
  const billing = useBilling();
  const workspace = useWorkspace();
  assertTrue(billing.enabled);
  assertFalse(billing.loading, "Billing must be loaded before using UsageSection component");

  const { isLoading, error, usage, throttle } = useEventsUsage();
  const period = billingPeriod(billing.settings);

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 1, width: "100%" }} title={false} />;
  } else if (error) {
    return <ErrorCard error={error} />;
  }

  assertDefined(usage, "Data should be defined");

  return (
    <div>
      <Progress
        percent={usage.usagePercentage * 100}
        showInfo={false}
        status={usage.usagePercentage > 1 ? "exception" : undefined}
      />
      <div className="flex items-center justify-between">
        <div>
          {formatNumber(Math.round(usage?.events))} / {formatNumber(usage.maxAllowedDestinatonEvents)} destination
          events used{period.interval === "year" ? " against your annual commitment" : ""} from{" "}
          <i>{dayjs(usage.periodStart).utc().format("MMM DD, YYYY")}</i> to{" "}
          <i>{dayjs(usage.periodEnd).utc().format("MMM DD, YYYY")}</i>. The quota will be reset on{" "}
          <i>{dayjs(usage.periodEnd).add(1, "day").utc().format("MMM DD")}</i>.
          <br />
          {billing?.settings?.overagePricePer100k && (
            <div className="text-textLight text-xs">
              Overage fee: ${billing.settings.overagePricePer100k * 10} per 1,000,000 events
            </div>
          )}
        </div>
        <Link
          href={`/${
            workspace.slugOrId
          }/settings/billing/details?start=${usage.periodStart.toISOString()}&end=${usage.periodEnd.toISOString()}`}
          className="flex items-center text-primary"
        >
          View detailed stat
          <ChevronRight className="h-5" />
        </Link>
      </div>

      {usage.usagePercentage > 1 && billing.settings.planId !== "free" && !throttle && (
        <div className="mt-8">
          <Alert
            message={<h4 className="font-bold">Overage fee warning</h4>}
            description={
              <div>
                You have exceeded your {period.adjective} events destination limit by{" "}
                <b>{formatNumber(usage.events - usage.maxAllowedDestinatonEvents)}</b>. The overage fee of at least $
                <b>
                  {(
                    ((usage.events - usage.maxAllowedDestinatonEvents) / 100_000) *
                    (billing.settings?.overagePricePer100k || 0)
                  ).toLocaleString("en-us", { maximumFractionDigits: 2 })}
                </b>{" "}
                will be added to your next invoice.{" "}
                {usage.projectionByTheEndOfPeriod && (
                  <>
                    The projected overage fee by the end of the {period.noun} is{" "}
                    <b>
                      $
                      {(
                        ((usage?.projectionByTheEndOfPeriod - usage.maxAllowedDestinatonEvents) / 100_000) *
                        (billing.settings?.overagePricePer100k || 0)
                      ).toLocaleString("en-us", { maximumFractionDigits: 2 })}
                    </b>{" "}
                  </>
                )}
              </div>
            }
            type="info"
            showIcon
          />
        </div>
      )}
    </div>
  );
};

const ConnectorUsageSection: React.FC<{}> = () => {
  const billing = useBilling();
  assertTrue(billing.enabled, "Billing is not enabled");
  assertFalse(billing.loading, "Billing must be loaded before using CurrentSubscription component");
  const workspace = useWorkspace();
  const user = useUser();
  //the sync limit is monthly even on an annual plan, so this window is not the billing period
  const { start: periodStart, end: periodEnd } = syncQuotaWindow(billing.settings);
  const { isLoading, error, data } = useQuery(
    ["connector usage", workspace.id, periodStart.toISOString()],
    async () => {
      const report = await rpc(
        `/api/${workspace.id}/reports/sync-stat?start=${periodStart.toISOString()}&end=${dayjs(periodEnd)
          .subtract(1, "millisecond")
          .toISOString()}`
      );
      return report;
    },
    { retry: false, cacheTime: 0, staleTime: 0 }
  );

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 1, width: "100%" }} title={false} />;
  } else if (error) {
    return <ErrorCard error={error} />;
  }

  const activeSyncs = data.activeSyncs;
  const maxActiveSyncs = billing.settings.dailyActiveSyncs || 1;
  const percentage = activeSyncs / maxActiveSyncs;

  return (
    <div>
      <Progress percent={percentage * 100} showInfo={false} status={percentage > 1 ? "exception" : undefined} />
      <div className="flex items-center justify-between">
        <div>
          {activeSyncs} / {maxActiveSyncs} monthly active syncs from{" "}
          <i>{dayjs(periodStart).utc().format("MMM DD, YYYY")}</i> to{" "}
          <i>{dayjs(periodEnd).utc().format("MMM DD, YYYY")}</i>. The quota will be reset on{" "}
          <i>{dayjs(periodEnd).add(1, "day").utc().format("MMM DD")}</i>.
          {billing?.settings?.dailyActiveSyncsOverage && (
            <div className="text-textLight text-xs">
              Overage fee: ${billing?.settings?.dailyActiveSyncsOverage} per extra daily active sync
            </div>
          )}
        </div>
      </div>
      {percentage > 1 && (
        <div className="mt-8 w-full">
          <Alert
            message={<h4 className="font-bold">Overage fee warning</h4>}
            description={
              <>
                Overage fee of at least $
                <b>{(billing.settings.dailyActiveSyncsOverage || 0) * (activeSyncs - maxActiveSyncs)}</b> will be added
                to your next invoice.
              </>
            }
          />
        </div>
      )}
    </div>
  );
};

const CurrentSubscription: React.FC<{}> = () => {
  const billing = useBilling();
  assertTrue(billing.enabled, "Billing is not enabled");
  assertFalse(billing.loading, "Billing must be loaded before using CurrentSubscription component");

  const workspace = useWorkspace();
  const eeRedirect = useEeRedirect();
  return (
    <div className="border border-textDisabled rounded-lg px-6 py-12">
      <div className="flex flex-row justify-between">
        <div className="">
          <div className="text-2xl text-textDark font-bold">
            {billing.settings?.customBilling
              ? "JITSU SUBSCRIPTION"
              : (billing.settings.planName || billing.settings.planId).toUpperCase()}
          </div>
          <div className="text-primary">
            {billing.settings.planId !== "free" && !billing.settings?.customBilling && (
              <a
                className="flex items-center cursor-pointer"
                onClick={() =>
                  eeRedirect("billing/manage", { workspaceId: workspace.id, returnUrl: window.location.href })
                }
              >
                <span>Manage subscription / download invoices</span>
                <Edit2 className="ml-1 h-3 w-3" />
              </a>
            )}
            {billing.settings?.futureSubscriptionDate && (
              <div className="text-textLight">
                Your paid subscription starts on{" "}
                {new Intl.DateTimeFormat("en-US", {
                  month: "long",
                  year: "numeric",
                  day: "numeric",
                }).format(new Date(billing.settings?.futureSubscriptionDate))}
              </div>
            )}
          </div>
        </div>
        <div>
          {billing.settings.planId !== "free" && (
            <div className="flex items-center">
              {billing.settings?.renewAfterExpiration ? (
                <div className="text-textLight">Renews at</div>
              ) : (
                <div className="text-error">Cancels at</div>
              )}
              <div className="ml-2 rounded-3xl bg-textDark text-backgroundLight px-3 py-1 text-sm">
                {/* expiresAt is a UTC instant (an anniversary at 00:00 UTC on an annual
                    plan); the local zone would show the previous day west of UTC, and
                    every other period date on this page is already rendered in UTC */}
                {dayjs(billing.settings?.expiresAt as string)
                  .utc()
                  .format("MMMM DD, YYYY")}
              </div>
            </div>
          )}
        </div>
      </div>
      <h3 className="text-lg text-textLight mt-6 mb-2">Events Usage</h3>
      <EventsUsageSection />
      {billing.settings?.planId !== "free" && (
        <>
          <h3 className="text-lg text-textLight mt-6 mb-2">Connectors Usage</h3>
          <ConnectorUsageSection />
        </>
      )}
      {/* Billing banners from billing/settings, nested compact under the last
          usage section: no extra widget zone (the sections' own charts cover
          usage) and no action (it would navigate to this very page). Only
          banners the server moved off the top strip (onBillingPage: false) —
          default-visible ones already show there. Modal payloads (e.g.
          past-due escalated) render as compact cards too: this page
          suppresses blocking modals but must still inform. */}
      {(billing.settings?.banners ?? [])
        .filter(banner => banner.onBillingPage === false)
        .map(banner => (
          <div key={banner.id} className="mt-3">
            <BannerCard banner={banner} compact />
          </div>
        ))}
    </div>
  );
};

const AvailablePlans: React.FC<{}> = () => {
  const appConfig = useAppConfig();
  const billing = useBilling();
  assertTrue(billing.enabled, "Billing is not enabled");
  assertFalse(billing.loading, "Billing must be loaded before using CurrentSubscription component");

  const workspace = useWorkspace();
  const user = useUser();
  const { eeRpc } = useEeApi();
  const eeRedirect = useEeRedirect();

  const { isLoading, error, data } = useQuery(
    ["availablePlans", workspace.id],
    async () => {
      if (billing.settings?.isLegacyPlan) {
        return {
          plans: {},
        };
      }
      const plans = await eeRpc("billing/plans", { query: { workspaceId: workspace.id } });
      assertDefined(billing.settings.planId, `planId is not defined in ${JSON.stringify(billing.settings)}`);

      return {
        plans: {
          free: { ...BillingSettings.parse({}), monthlyPrice: 0, annualPrice: 0 },
          ...plans.products
            //the end-point shouldn't return custom plans anyway,
            //but let's double-check that the plan is not custom
            .filter(p => !p.data.disabled && !p.data.custom)
            .reduce(
              (acc, p) => ({
                ...acc,
                [requireDefined(p.id, `No id in ${JSON.stringify(p)}`)]: {
                  ...BillingSettings.parse(requireDefined(p.data, `No data in ${JSON.stringify(p)}`)),
                  name: requireDefined(p.name, `No name in ${JSON.stringify(p)}`),
                  monthlyPrice: requireDefined(p.monthlyPrice, `No monthlyPrice in ${JSON.stringify(p)}`),
                  annualPrice: p.annualPrice,
                },
              }),
              {}
            ),
          enterprise: {
            ...BillingSettings.parse({
              planId: "enterprise",
              destinationEvensPerMonth: -1,
              overagePricePer100k: undefined,
              canShowProvisionDbCredentials: true,
            }),
            monthlyPrice: -1,
            annualPrice: -1,
            name: "enterprise",
          },
        },
      } as BillingState;
    },
    { cacheTime: 0, retry: false }
  );
  //if (billing.settings?.customBilling)
  if (isLoading) {
    return <Skeleton active />;
  } else if (error) {
    return <ErrorCard error={error} title="Failed to load available plans" />;
  }
  assertDefined(data, "Data is not defined");
  if (billing.settings?.isLegacyPlan) {
    return (
      <div className="text-center">
        <div className="text-textLight mt-6">
          You're using a legacy plan. To upgrade to a new plan or cancel your subscription, please reach out to our{" "}
          <Link className="text-primary underline" href={`/${workspace.slugOrId}/support`}>
            Support Team
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-row flex-nowrap justify-center space-x-6">
      {Object.entries(data.plans).map(([planId, plan]) => (
        <div key={planId} className="border py-4 px-6 border-backgroundDark rounded-xl w-96">
          <h3 className="text-textDark font-bold font-xl uppercase">{plan.name || "Free"}</h3>
          <div className="my-6 ">
            {plan.monthlyPrice >= 0 ? (
              <>
                <span className="text-2xl">${plan.monthlyPrice}</span>
                <span className="text-textLight"> / month</span>
              </>
            ) : (
              <span className="text-2xl">Custom pricing</span>
            )}
          </div>
          <ComparisonSection
            key="destination-events"
            header="Destination events included"
            info="Destination events are events sent to your destinations."
            items={[
              plan.destinationEvensPerMonth > 0
                ? `${formatNumber(plan.destinationEvensPerMonth)} per month`
                : `Unlimited`,
            ]}
          />
          <ComparisonSection
            key="fee"
            header="More events"
            items={[
              plan.overagePricePer100k
                ? { enabled: true, header: `$${plan.overagePricePer100k} per 100,000 events ` }
                : { enabled: false, header: "n/a" },
            ]}
          />
          <ComparisonSection
            key="clickhouse"
            header="Clickhouse"
            items={[
              { enabled: true, header: "UI Access" },
              { enabled: plan.canShowProvisionDbCredentials, header: "API Access" },
            ]}
          />
          <div className="my-6">
            {planId === billing.settings.planId ? (
              <JitsuButton icon={<Check />} className="w-full" size="large" ghost disabled={true}>
                Current plan
              </JitsuButton>
            ) : planId === "free" ? (
              <Button
                onClick={() =>
                  eeRedirect("billing/manage", { workspaceId: workspace.id, returnUrl: window.location.href })
                }
                className="w-full"
                size="large"
              >
                Downgrade
              </Button>
            ) : plan.monthlyPrice >= 0 ? (
              <Button
                onClick={() =>
                  billing.settings.planId === "free"
                    ? eeRedirect("billing/upgrade", {
                        workspaceId: workspace.id,
                        planId,
                        returnUrl: window.location.href,
                        email: user.email,
                      })
                    : eeRedirect("billing/manage", { workspaceId: workspace.id, returnUrl: window.location.href })
                }
                className="w-full"
                size="large"
                type="primary"
              >
                Upgrade
              </Button>
            ) : (
              <Button
                className="w-full"
                size="large"
                href={`${appConfig.websiteUrl || "https://jitsu.com"}/contact?utm_source=app`}
              >
                Contact us
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

const BillingManager0: React.FC<{}> = () => {
  const appConfig = useAppConfig();
  const billing = useBilling();

  return (
    <div>
      <CurrentSubscription />
      {billing.settings?.customBilling || billing.settings?.custom ? (
        <div className="text-center text-textLight mt-12">
          You're using a custom plan. To downgrade to standard plan or cancel your supbscription, please reach out to
          our{" "}
          <Link className="text-primary underline" href={"/support"}>
            Support Team
          </Link>
        </div>
      ) : (
        <>
          <h3 className="my-12 text-2xl text-center">Available Plans</h3>
          <AvailablePlans />
          <p className="text-center text-textLight text-sm mt-12">
            Need more information? Learn more about each plan by checking out our{" "}
            <a className="text-primary" href={`${appConfig.websiteUrl || "https://jitsu.com"}/pricing?utm_source=app`}>
              pricing page
            </a>
          </p>
        </>
      )}
    </div>
  );
};

export const BillingManager = React.memo(BillingManager0);
