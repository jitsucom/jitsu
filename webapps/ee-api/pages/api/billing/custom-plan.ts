import { NextApiRequest, NextApiResponse } from "next";
import { getAvailableProducts, stripe } from "../../../lib/stripe";
import { withErrorHandler } from "../../../lib/error-handler";
import { requireDefined } from "juava";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  const token = req.query.token;
  if (!token) {
    throw new Error(`Missing token parameter`);
  }
  const product = (await getAvailableProducts({ custom: true })).find(
    p => p.metadata?.plan_data && JSON.parse(p.metadata?.plan_data).token === token
  );
  if (!product) {
    throw new Error(`Invalid token ${token}`);
  }
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
  const monthlyPrice = requireDefined(
    prices.data.find(p => p.recurring?.interval === "month"),
    `No monthly price for ${product.id}`
  );
  return {
    id: product.metadata?.jitsu_plan_id,
    data: JSON.parse(product.metadata?.plan_data),
    name: product.name,
    monthlyPrice: requireDefined(monthlyPrice.unit_amount, `No unit_amount on monthly price for ${product.id}`) / 100,
  };
};

export default withErrorHandler(handler);
