import type { NextApiRequest, NextApiResponse } from "next";
import { assertTrue, getLog } from "juava";
import { withErrorHandler } from "../../../lib/error-handler";
import { auth } from "../../../lib/auth";
import { pg, store } from "../../../lib/services";
import {
  getAvailableProducts,
  getInvoiceEndDate,
  getInvoiceStartDate,
  listAllInvoices,
  stripe,
  stripeDataTable,
  stripeLink,
} from "../../../lib/stripe";
import Stripe from "stripe";
import pick from "lodash/pick";
import { buildWorkspaceReport, query } from "./workspace-stat";
import { getServerLog } from "../../../lib/log";
import dayjs from "dayjs";

const log = getServerLog("/api/overage");

function toUTC(date: Date | string) {
  const dateObj = new Date(date);
  const timezoneOffset = dateObj.getTimezoneOffset();
  return new Date(dateObj.getTime() - timezoneOffset * 60000);
}

async function getSyncsStat(periodStart: Date, periodEnd: Date, workspaceId: string): Promise<{ activeSyncs: number }> {
  const res = await query(
    pg,
    `select
        count(distinct sync."fromId" || sync."toId") as "activeSyncs"
     from newjitsu.source_task task
     join newjitsu."ConfigurationObjectLink" sync on task.sync_id = sync."id"
     where 
        (task.status = 'SUCCESS' OR task.status = 'PARTIAL') and deleted = false 
        and "workspaceId" = :workspaceId and started_at >= :periodStart and started_at < :periodEnd`,
    { periodStart, periodEnd, workspaceId }
  );
  return res[0] as any;
}

const msPerHour = 1000 * 60 * 60;
const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const claims = await auth(req, res);
  const workspaceId: string | undefined = req.query.workspaceId ? (req.query.workspaceId as string) : undefined;
  if (!workspaceId) {
    assertTrue(claims?.type === "admin", "Should be admin");
  } else {
    assertTrue(
      claims?.type === "admin" || (claims?.type === "user" && claims?.workspaceId === workspaceId),
      `User doesn't have access to workspace ${workspaceId}`
    );
  }
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
  if (req.method === "OPTIONS") {
    //allowing requests from everywhere since our tokens are short-lived
    //and can't be hijacked
    res.status(200).end();
    return;
  }
  const timerAllWorkspaces = Date.now();
  const allWorkspaces = workspaceId
    ? [
        {
          id: workspaceId,
          obj: await store.getTable(stripeDataTable).get(workspaceId),
        },
      ]
    : await store.getTable(stripeDataTable).list();

  getLog()
    .atInfo()
    .log(`Got ${allWorkspaces.length} workspaces in ${Date.now() - timerAllWorkspaces}ms`);

  const availableProducts = await getAvailableProducts({ custom: true });
  const subscriptionCache: Record<string, Stripe.Subscription> = {};

  const result: any[] = [];
  const allInvoices = await listAllInvoices();
  const allCustomers = new Set(allWorkspaces.map(w => w.obj.stripeCustomerId));
  const eligibleInvoices = allInvoices.filter(i => allCustomers.has(i.customer)).filter(i => i.lines.data.length > 0);
  const minDate = eligibleInvoices.map(i => getInvoiceStartDate(i)).sort((a, b) => a.getTime() - b.getTime())[0];

  const timer = Date.now();
  const report = await buildWorkspaceReport(minDate.toISOString(), new Date().toISOString(), "day", workspaceId);
  getLog()
    .atInfo()
    .log(`Build workspace report from ${minDate.toISOString()}. Took ${Date.now() - timer}ms`);

  const resultBuilderTimer = Date.now();
  for (const { id: workspaceId, obj } of allWorkspaces) {
    const { stripeCustomerId } = obj;

    const customerInvoices = eligibleInvoices.filter(i => i.customer === stripeCustomerId);
    if (customerInvoices.length === 0) {
      continue;
    }
    // log
    //   .atInfo()
    //   .log(
    //     `Found ${customerInvoices.length} invoices for workspace ${workspaceId} / customer ${stripeLink(
    //       "customers",
    //       stripeCustomerId
    //     )}`
    //   );
    for (const invoice of customerInvoices) {
      if (!invoice.lines.data.length) {
        log.atWarn().log(`No lines found for invoice ${invoice.id}`);
        continue;
      }
      const start = getInvoiceStartDate(invoice);
      const end = getInvoiceEndDate(invoice);
      const product = invoice.lines.data
        .filter(l => !!l.plan)
        .map(l => l.plan!.product)
        .join("");
      const subscriptionId = invoice.lines.data
        .filter(l => !!l.subscription)
        .map(l => l.subscription)
        .join("");
      if (subscriptionId === "") {
        log.atWarn().log(`No subscription found for invoice ${stripeLink("invoices", invoice.id)}, skipping`);
        continue;
      }
      const plan = availableProducts.find(p => p.id === product);
      if (!plan) {
        log.atWarn().log(`No plan found for ${product} from invoice ${stripeLink("invoices", invoice.id)}`);
        continue;
      }
      const { overagePricePer100k, destinationEvensPerMonth, dailyActiveSyncs } = JSON.parse(plan.metadata.plan_data);
      const overagePricePerEvent = overagePricePer100k / 100_000;
      const startTimestamp = dayjs(start).utc().startOf("day").toDate().getTime();
      const endTimestamp = dayjs(end).utc().startOf("day").add(-1, "millisecond").toDate().getTime();
      const rows = report.filter(row => {
        const rowTimestamp = dayjs(row.period).utc().toDate().getTime();
        return row.workspaceId === workspaceId && rowTimestamp >= startTimestamp && rowTimestamp <= endTimestamp;
      });
      const destinationEvents = rows.reduce((acc, row) => acc + row.events, 0);
      const overageFee = (Math.max(0, destinationEvents - destinationEvensPerMonth) / 100_000) * overagePricePer100k;
      const discountPercentage = invoice?.discount?.coupon?.percent_off || 0;
      const overageFeeFinal = overageFee * (1 - discountPercentage / 100);

      const projectedEvents =
        (destinationEvents / ((Math.min(Date.now(), end.getTime()) - start.getTime()) / msPerHour)) *
        ((end.getTime() - start.getTime()) / msPerHour);
      const projectedOverageFeeFinal =
        (Math.max(0, projectedEvents - destinationEvensPerMonth) / 100_000) *
        overagePricePer100k *
        (1 - discountPercentage / 100);
      getLog().atDebug().log(`Getting sync stat for ${start} - ${end} for workspace ${workspaceId}`);
      let syncStatTimer = Date.now();
      const syncStat = await getSyncsStat(start, end, workspaceId);
      syncStatTimer = Date.now() - syncStatTimer;
      getLog().atDebug().log(`Got sync stat for ${workspaceId} in ${syncStatTimer}ms`);
      result.push({
        month: start.toLocaleString("en-US", { month: "long", year: "numeric" }),
        baseInvoiceId: invoice.id,
        workspaceId,
        stripeCustomerId,
        subscriptionId,
        start,
        monthlyActiveSyncs: syncStat.activeSyncs,
        monthlyActiveSyncsLimit: dailyActiveSyncs,
        end,
        roundedPeriod: {
          start: dayjs(startTimestamp).utc().toISOString(),
          end: dayjs(endTimestamp).utc().toISOString(),
        },
        destinationEvents,
        quota: {
          destinationEvensPerMonth,
          overagePricePer100k,
          overagePricePerEvent,
        },
        baseFee: (invoice.total - (invoice.tax || 0)) / 100,
        overageEvents: Math.max(0, destinationEvents - destinationEvensPerMonth),
        overageFee,
        discountPercentage,
        coupon: invoice.discount ? pick(invoice.discount.coupon, "id", "name") : undefined,
        couponName: invoice.discount ? invoice.discount.coupon.name : undefined,
        overageFeeFinal,
        projectedEvents,
        projectedOverageFeeFinal,
      });
    }
  }
  getLog()
    .atInfo()
    .log(`Built final result of ${result.length} rows in ${Date.now() - resultBuilderTimer}ms`);

  return res.status(200).json({
    stripeDataTable,
    result,
  });
};

export const config = {
  maxDuration: 120, //2 mins, mostly becasue of workspace-stat call
};

export default withErrorHandler(handler);
