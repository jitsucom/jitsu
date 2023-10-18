import type { NextApiRequest, NextApiResponse } from "next";
import { assertTrue } from "juava";
import { withErrorHandler } from "../../../lib/error-handler";
import { auth } from "../../../lib/auth";
import { store } from "../../../lib/services";
import { getAvailableProducts, stripe, stripeDataTable } from "../../../lib/stripe";
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

function stripeLink(entity: string, id: string) {
  return `https://dashboard.stripe.com/${entity}/${id}`;
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
    log.atInfo().log(`Fetched ${result?.data.length} invoices. Has more: ${!!starting_after}`);
    if (result?.data) {
      allInvoices.push(...result?.data);
    }
  } while (starting_after);
  log.atInfo().log(`${allInvoices.length} invoices found`);
  return allInvoices;
}

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
  const report = await buildWorkspaceReport(
    new Date("2023-01-01").toISOString(),
    new Date().toISOString(),
    "day",
    workspaceId
  );

  const allWorkspaces = workspaceId
    ? [
        {
          id: workspaceId,
          obj: await store.getTable(stripeDataTable).get(workspaceId),
        },
      ]
    : await store.getTable(stripeDataTable).list();

  const availableProducts = await getAvailableProducts();
  const subscriptionCache: Record<string, Stripe.Subscription> = {};

  const result: any[] = [];
  const allInvoices = await listAllInvoices();
  for (const { id: workspaceId, obj } of allWorkspaces) {
    const { stripeCustomerId } = obj;

    const customerInvoices = allInvoices.filter(i => i.customer === stripeCustomerId);
    if (customerInvoices.length === 0) {
      continue;
    }
    log
      .atInfo()
      .log(
        `Found ${customerInvoices.length} invoices for workspace ${workspaceId} / customer ${stripeLink(
          "customers",
          stripeCustomerId
        )}`
      );
    for (const invoice of customerInvoices) {
      if (!invoice.lines.data.length) {
        log.atWarn().log(`No lines found for invoice ${invoice.id}`);
        continue;
      }
      const start = new Date(invoice.lines.data[0].period.start * 1000);
      const end = new Date(invoice.lines.data[0].period.end * 1000);
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
            `Subscription ${stripeLink("subscriptions", invoice.id)} is canceled. Skipping invoice ${stripeLink(
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
      log
        .atInfo()
        .log(
          `Processing invoice ${invoice.id} for [${new Date(start).toISOString()}, ${new Date(
            end
          ).toISOString()}] workspace ${workspaceId}, plan ${plan.id}`
        );
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
      log
        .atInfo()
        .log(
          `Found ${rows.length} rows for ${workspaceId} for [${new Date(invoiceStartRounded).toISOString()}, ${new Date(
            invoiceEndRounded
          ).toISOString()}]: \n ${JSON.stringify(rows, null, 2)}}`
        );
      const destinationEvents = rows.reduce((acc, row) => acc + row.events, 0);
      log
        .atInfo()
        .log(
          `Destination events for ${workspaceId} for [${new Date(invoiceStartRounded).toISOString()}, ${new Date(
            invoiceEndRounded
          ).toISOString()}] → ${destinationEvents}`
        );
      const overageFee = (Math.max(0, destinationEvents - destinationEvensPerMonth) / 100_000) * overagePricePer100k;
      const discountPercentage = invoice.discount ? invoice.discount.coupon.percent_off : undefined;
      let overageFeeFinal = discountPercentage ? overageFee * (1 - discountPercentage / 100) : overageFee;
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
      });
    }
  }

  return res.status(200).json({
    stripeDataTable,
    result,
  });
};

export default withErrorHandler(handler);
