import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../../lib/auth";
import { getAvailableProducts, getOrCreateCurrentSubscription, stripe } from "../../../lib/stripe";
import { requireDefined } from "juava";
import { withErrorHandler } from "../../../lib/route-helpers";

import { getServerLog } from "../../../lib/log";

const log = getServerLog("/api/billing/create");

export type ErrorResponse = {
  ok: false;
  error: string;
};

type Product = {
  //=metadata.jitsu_plan_id
  id: string;
  name: string;
  monthlyPrice: number;
  annualPrice?: number;
  data: Record<string, any>;
};

type Response = {
  products: Product[];
};
const handler = async function handler(req: NextApiRequest, res: NextApiResponse<ErrorResponse | Response>) {
  if (req.method === "OPTIONS") {
    //allowing requests from everywhere since our tokens are short-lived
    //and can't be hijacked
    return res.status(200).end();
  }
  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  const workspaceId = req.query.workspaceId as string;
  if (claims.type === "user" && claims.workspaceId !== workspaceId) {
    const msq = `Claimed workspaceId ${claims.workspaceId} does not match requested workspaceId ${workspaceId}`;
    log.atError().log(msq);
    return res.status(400).json({ ok: false, error: msq });
  }

  const { stripeCustomerId } = await getOrCreateCurrentSubscription(workspaceId, () =>
    requireDefined(req.query.email as string, "email parameter is required")
  );

  const products = await getAvailableProducts();
  const result: Product[] = [];
  for (const product of products) {
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
    const monthly = requireDefined(
      prices.data.find(p => p.recurring?.interval === "month"),
      `No monthly price for ${product.id}`
    );
    const annual = prices.data.find(p => p.recurring?.interval === "year");
    const planData = JSON.parse(requireDefined(product.metadata?.plan_data, `No data for ${product.id}`));
    result.push({
      id: product.metadata?.jitsu_plan_id,
      data: planData,
      name: product.name,
      monthlyPrice: requireDefined(monthly.unit_amount, `No unit_amount on monthly price for ${product.id}`) / 100,
      annualPrice: annual
        ? requireDefined(annual?.unit_amount, `No unit_amount on annual price for ${product.id}`) / 100
        : undefined,
    });
  }

  return { products: result };
};

export default withErrorHandler(handler);
