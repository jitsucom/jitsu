import { NextApiRequest, NextApiResponse } from "next";
import { exportSubscriptions, getAvailableProducts, stripe } from "../../../lib/stripe";
import { withErrorHandler } from "../../../lib/route-helpers";
import { assertTrue, requireDefined } from "juava";
import { auth } from "../../../lib/auth";
import { store } from "../../../lib/services";

const extendedStripeData =
  (process.env.STRIPE_SECRET_KEY as string)?.indexOf("_live_") >= 0 ? "stripe-customer-info" : "stripe-customer-info-test-mode";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const claims = await auth(req, res);
  if (!claims) {
    throw new Error("Unauthorized");
  }
  assertTrue(claims.type === "admin", "Only admins can export subscriptions");
  const subscriptions = await exportSubscriptions();
  await store.getTable(extendedStripeData).clear();
  for (const [sub, data] of Object.entries(subscriptions)) {
    await store.getTable(extendedStripeData).put(data.customer.id, data);
  }
  return res.json(subscriptions);

};

export default withErrorHandler(handler);
