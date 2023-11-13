import type { NextApiRequest, NextApiResponse } from "next";
import { assertTrue, getLog } from "juava";
import { withErrorHandler } from "../../../lib/error-handler";
import { auth } from "../../../lib/auth";
import { store } from "../../../lib/services";
import { getAvailableProducts, stripe, stripeDataTable, stripeLink } from "../../../lib/stripe";
import Stripe from "stripe";
import pick from "lodash/pick";
import { buildWorkspaceReport } from "./workspace-stat";
import { getServerLog } from "../../../lib/log";

const log = getServerLog("/api/overage");

function toUTC(date: Date | string) {
  const dateObj = new Date(date);
  const timezoneOffset = dateObj.getTimezoneOffset();
  return new Date(dateObj.getTime() - timezoneOffset * 60000);
}

function round(date: Date | string, granularity: "day" = "day"): { start: string; end: string } {
  try {
    const dateObj = toUTC(date).toISOString();
    const day = dateObj.split("T")[0];
    const start = `${day}T00:00:00.000Z`;
    const end = `${day}T23:59:59.999Z`;
    return { start, end };
  } catch (e) {
    throw new Error(`Can't parse date ${date}`);
  }
}

async function listAllInvoices() {
  const timer = Date.now();
  let starting_after: string | undefined = undefined;
  const allInvoices: Stripe.Invoice[] = [];
  do {
    const result = await stripe.invoices.list({
      limit: 100,
      starting_after: starting_after,
      created: {
        //invoices for past 90 days
        gte: Math.floor(Date.now() / 1000 - 90 * 24 * 60 * 60),
      },
    });
    starting_after = result?.data[result.data.length - 1]?.id;
    if (result?.data) {
      allInvoices.push(...result?.data);
    }
  } while (starting_after);
  log.atInfo().log(`${allInvoices.length} invoices found. Took ${Date.now() - timer}ms`);
  return allInvoices;
}

function getInvoiceStartDate(invoice: Stripe.Invoice) {
  return new Date(invoice.lines.data[0].period.start * 1000);
}

function getInvoiceEndDate(invoice: Stripe.Invoice) {
  return new Date(invoice.lines.data[0].period.end * 1000);
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

  const availableProducts = await getAvailableProducts();
  const subscriptionCache: Record<string, Stripe.Subscription> = {};

  const result: any[] = [];
  const allInvoices = await listAllInvoices();
  const allCustomers = new Set(allWorkspaces.map(w => w.obj.stripeCustomerId));
  const eligibleInvoices = allInvoices.filter(i => allCustomers.has(i.customer)).filter(i => i.lines.data.length > 0);
  getLog().atInfo().log(`Found ${eligibleInvoices.length} invoices for ${allCustomers.size} workspaces`);
  const minDate = eligibleInvoices.map(i => getInvoiceStartDate(i)).sort()[0];

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
      const subscription =
        subscriptionCache[subscriptionId] ||
        (subscriptionCache[subscriptionId] = await stripe.subscriptions.retrieve(subscriptionId));
      if (subscription.status === "canceled") {
        log
          .atWarn()
          .log(
            `Subscription ${stripeLink("subscriptions", subscription.id)} is canceled. Skipping invoice ${stripeLink(
              "invoices",
              invoice.id
            )}`
          );
        continue;
      }
      const plan = availableProducts.find(p => p.id === product);
      if (!plan) {
        log.atWarn().log(`No plan found for ${product} from invoice ${stripeLink("invoices", invoice.id)}`);
        continue;
      }
      // log
      //   .atInfo()
      //   .log(
      //     `Processing invoice ${invoice.id} for [${new Date(start).toISOString()}, ${new Date(
      //       end
      //     ).toISOString()}] workspace ${workspaceId}, plan ${plan.id}`
      //   );
      const { overagePricePer100k, destinationEvensPerMonth } = JSON.parse(plan.metadata.plan_data);
      const overagePricePerEvent = overagePricePer100k / 100_000;
      const invoiceStartRounded = round(start, "day").start;
      const invoiceEndRounded = round(end, "day").end;
      const rows = report.filter(row => {
        const { start, end } = round(row.period, "day");
        return (
          row.workspaceId === workspaceId &&
          Date.parse(start) >= Date.parse(invoiceStartRounded) &&
          Date.parse(end) <= Date.parse(invoiceEndRounded)
        );
      });
      // log
      //   .atInfo()
      //   .log(
      //     `Found ${rows.length} rows for ${workspaceId} for [${new Date(invoiceStartRounded).toISOString()}, ${new Date(
      //       invoiceEndRounded
      //     ).toISOString()}]`
      //   );
      const destinationEvents = rows.reduce((acc, row) => acc + row.events, 0);
      // log
      //   .atInfo()
      //   .log(
      //     `Destination events for ${workspaceId} for [${new Date(invoiceStartRounded).toISOString()}, ${new Date(
      //       invoiceEndRounded
      //     ).toISOString()}] → ${destinationEvents}`
      //   );
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

      result.push({
        month: start.toLocaleString("en-US", { month: "long", year: "numeric" }),
        baseInvoiceId: invoice.id,
        workspaceId,
        stripeCustomerId,
        subscriptionId,
        start,
        end,
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
