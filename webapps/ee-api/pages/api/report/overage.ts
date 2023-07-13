import type { NextApiRequest, NextApiResponse } from "next";
import { assertTrue, getLog, requireDefined } from "juava";
import { withErrorHandler } from "../../../lib/error-handler";
import { auth } from "../../../lib/auth";
import { pg, store } from "../../../lib/services";
import { getAvailableProducts, stripe, stripeDataTable } from "../../../lib/stripe";
import Stripe from "stripe";
import { queries, query } from "./[reportName]";
import { pick } from "lodash";

const log = getLog("/api/report");

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

  const allWorkspaces = workspaceId
    ? [
        {
          id: workspaceId,
          obj: await store().getTable(stripeDataTable).get(workspaceId),
        },
      ]
    : await store().getTable(stripeDataTable).list();

  const availableProducts = await getAvailableProducts();

  const report: any[] = [];
  for (const { id: workspaceId, obj } of allWorkspaces) {
    const { stripeCustomerId } = obj;
    let starting_after: string | undefined = undefined;
    const customerInvoices: Stripe.Invoice[] = [];
    do {
      const result = await stripe.invoices.list({
        limit: 100,
        starting_after: starting_after,
        customer: stripeCustomerId,
      });
      starting_after = result?.data[result.data.length - 1]?.id;
      if (result?.data) {
        customerInvoices.push(...result?.data);
      }
    } while (starting_after);

    const metricsTable = `${process.env.METRICS_SCHEMA || "bulker"}.bulker_metrics`;
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
      const plan = availableProducts.find(p => p.id === product);
      if (!plan) {
        log.atWarn().log(`No plan found for ${product} from invoice ${invoice.id}`);
        continue;
      }
      const { overagePricePer100k, destinationEvensPerMonth } = JSON.parse(plan.metadata.plan_data);
      const sqlQuery = requireDefined(queries["destination-stat"], `destination-stat`)({ metricsTable });
      const overagePricePerEvent = overagePricePer100k / 100_000;

      const data = await query(await pg(), sqlQuery, { workspaceId, granularity: "day", start, end });

      const destinationEvents = data.reduce((acc, row) => acc + row.events, 0);
      const overageFee = (Math.max(0, destinationEvents - destinationEvensPerMonth) / 100_000) * overagePricePer100k;
      const discountPercentage = invoice.discount ? invoice.discount.coupon.percent_off : undefined;
      report.push({
        month: start.toLocaleString("en-US", { month: "long", year: "numeric" }),
        baseInvoiceId: invoice.id,
        workspaceId,
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
        overageFeeFinal: discountPercentage ? overageFee * (1 - discountPercentage / 100) : overageFee,
      });
    }
  }

  return res.status(200).json({
    stripeDataTable,
    report,
  });
};

export default withErrorHandler(handler);
