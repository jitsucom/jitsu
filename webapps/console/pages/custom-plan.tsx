import { useAppConfig, useUser } from "../lib/context";
import { useEeApi, useEeRedirect } from "../lib/eeApi";
import { ErrorCard } from "../components/GlobalError/GlobalError";
import { Button, Select } from "antd";
import Link from "next/link";
import { useRouter } from "next/router";
import { useQuery } from "@tanstack/react-query";
import { rpc } from "juava";
import { LoadingAnimation } from "../components/GlobalLoader/GlobalLoader";
import { useEffect, useState } from "react";
import { chargeCadence } from "../components/Billing/billing-period";

function timeUntil(date: Date): { days: number; hours: number; minutes: number; seconds: number } {
  const now = new Date();
  const difference = date.getTime() - now.getTime();

  if (difference <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  const seconds = Math.floor((difference / 1000) % 60);
  const minutes = Math.floor((difference / 1000 / 60) % 60);
  const hours = Math.floor((difference / 1000 / 60 / 60) % 24);
  const days = Math.floor(difference / 1000 / 60 / 60 / 24);

  return { days, hours, minutes, seconds };
}

const Countdown: React.FC<{ deadline: Date }> = p => {
  const [until, setUntil] = useState(timeUntil(p.deadline));
  useEffect(() => {
    const interval = setInterval(() => setUntil(timeUntil(p.deadline)), 500);
    return () => clearInterval(interval);
  }, [p.deadline]);
  const { days, hours, minutes, seconds } = until;
  return (
    <div className=" bg-background px-8 py-4 rounded-lg border border-textDisabled max-w-screen-md mx-auto">
      <div className="mb-4 text-textLight">Valid for</div>
      <div className="flex justify-center items-center space-x-2 font-mono">
        <div key="days" className="flex flex-col items-center">
          <div key="val" className="text-4xl font-bold">
            {days}
          </div>
          <div className="text-gray-500">Days</div>
        </div>
        <div key="delim1" className="flex flex-col items-center">
          <div key="val" className="text-4xl font-bold invisible">
            :
          </div>
          <div className="text-gray-500 invisible">XXX</div>
        </div>
        <div key="hours" className="flex flex-col items-center">
          <div key="val" className="text-4xl font-bold">
            {hours}
          </div>
          <div className="text-gray-500">Hours</div>
        </div>
        <div key="delim2" className="flex flex-col items-center">
          <div key="val" className="text-4xl font-bold">
            :
          </div>
          <div className="text-gray-500 invisible">XXX</div>
        </div>
        <div key="mins" className="flex flex-col items-center">
          <div key="val" className="text-4xl font-bold">
            {minutes}
          </div>
          <div className="text-gray-500">Minutes</div>
        </div>
        <div key="delim3" className="flex flex-col items-center">
          <div key="val" className="text-4xl font-bold">
            :
          </div>
          <div className="text-gray-500 invisible">XXX</div>
        </div>
        <div key="secs" className="flex flex-col items-center">
          <div key="val" className="text-4xl font-bold">
            {seconds}
          </div>
          <div className="text-gray-500">Seconds</div>
        </div>
      </div>
    </div>
  );
};

const CustomPlanView: React.FC<{ token: string }> = ({ token }) => {
  const { eeRpc } = useEeApi();
  const eeRedirect = useEeRedirect();
  const { isLoading, error, data } = useQuery(
    ["customPlan", token],
    async () => {
      const plan = await eeRpc("billing/custom-plan", { query: { token } });
      const workspaces = await rpc(`/api/workspace`);

      return { plan, workspaces };
    },
    { retry: false, cacheTime: 0 }
  );
  const router = useRouter();
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | undefined>(
    router.query.workspaceId as string | undefined
  );
  const user = useUser();

  if (error) {
    return (
      <div className="flex justify-center items-center h-full">
        <ErrorCard error={error} />
      </div>
    );
  } else if (isLoading) {
    return (
      <div className="flex justify-center items-center h-full">
        <LoadingAnimation />
      </div>
    );
  } else if (!data) {
    //never can happen - throw instead of error display
    throw new Error(`Data is empty`);
  }

  // A negotiated quote can be monthly or annual (JITSU-200). Two independent
  // cadences describe it: what one charge covers (`interval` x `intervalCount`
  // of the Stripe price — an annual commitment is often invoiced quarterly) and
  // the period the included events are metered over (`billingInterval`, the
  // contract year for an annual commitment). Labelling the committed volume
  // with the charge cadence would show a quarterly-invoiced 18B/year deal as
  // "18B events per quarter". `interval`/`price` are absent on a billing API
  // that predates annual quotes; fall back to the monthly-only shape it sends.
  const chargeInterval: "month" | "year" = data.plan.interval === "year" ? "year" : "month";
  const cadence = chargeCadence(chargeInterval, data.plan.intervalCount ?? 1);
  // An explicit metering interval always wins — "month" on an annual price is a
  // monthly quota with a yearly invoice, not an annual commitment.
  const meteringInterval: "month" | "year" =
    data.plan.billingInterval === "year" || data.plan.billingInterval === "month"
      ? data.plan.billingInterval
      : chargeInterval;
  const price = data.plan.price ?? data.plan.monthlyPrice;
  const includedEvents = data.plan.data.destinationEventsPerPeriod ?? data.plan.data.destinationEvensPerMonth;
  const terms =
    meteringInterval === "year"
      ? `The committed volume covers the whole contract year, billed ${cadence.billed}.`
      : cadence.per === "month"
      ? "Month-to-month, cancel at any time"
      : `Billed ${cadence.billed}.`;

  return (
    <section className="w-full py-16 md:py-28 lg:py-36 flex justify-center">
      <div className="container px-4 md:px-6">
        <div className="flex flex-col items-center space-y-6 text-center">
          <div className="space-y-4">
            <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl lg:text-6xl/none">
              Custom Pricing Plan
            </h1>
            {data.plan.data.validUntil && (
              <div className="flex flex-col justify-center">
                <Countdown deadline={new Date(data.plan.data.validUntil)} />
              </div>
            )}
            <p className="mx-auto max-w-[700px] md:text-xl">Select a workspace to apply a custom plan:</p>
          </div>
          <div className="w-full max-w-sm space-y-4">
            <form className="flex flex-col space-y-4">
              <Select
                size="large"
                onSelect={v => {
                  setSelectedWorkspace(v);
                }}
                placeholder="Select a workspace"
                value={selectedWorkspace}
                options={data.workspaces
                  .sort((w1, w2) => w1.name.localeCompare(w2.name))
                  .map(w => ({ value: w.id, label: w.name }))}
              />
              <div className="flex flex-col space-y-4">
                <p className="text-2xl">
                  <span className="font-bold">${price}</span>
                  <span className="text-textLight">/{cadence.per}</span>
                </p>
                <div className="text-textLight">
                  Terms:{" "}
                  <b>
                    {Number.parseInt(includedEvents).toLocaleString("en-US", {
                      maximumFractionDigits: 0,
                    })}
                  </b>{" "}
                  events per {meteringInterval} included, <b>${data.plan.data.overagePricePer100k * 10}</b> per extra
                  million events. {terms}
                </div>
              </div>
              <Button
                type="primary"
                size="large"
                disabled={!selectedWorkspace}
                onClick={() =>
                  eeRedirect("billing/upgrade", {
                    workspaceId: selectedWorkspace,
                    planId: data.plan.id,
                    // the quote token authorizes checkout of a negotiated (custom) plan, not
                    // just its discovery — without it anyone knowing the plan id could check
                    // out at the negotiated price
                    token,
                    email: user.email,
                    returnUrl: `${window.location.origin}/${selectedWorkspace}/settings/billing`,
                    cancelUrl: window.location.href,
                  })
                }
              >
                Accept Plan
              </Button>
            </form>
            <p className="text-xs text-textLight">
              By accepting, you agree to the terms and conditions of this pricing plan.{" "}
              <Link className="underline underline-offset-2" href="https://jitsu.com/tos">
                Terms & Conditions
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

const CustomPlan: React.FC<{}> = () => {
  const appConfig = useAppConfig();
  const router = useRouter();
  if (!appConfig.ee) {
    return (
      <div className="pt-12">
        <ErrorCard title="Error" error="Billing is not enabled" />
      </div>
    );
  } else if (!router.query.planToken) {
    return (
      <div className="pt-12">
        <ErrorCard title="Unknown plan" error="token param is missing" />
      </div>
    );
  } else {
    return <CustomPlanView token={router.query.planToken as string} />;
  }
};

export default CustomPlan;
