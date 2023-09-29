import { NextApiRequest, NextApiResponse } from "next";
import { store } from "../../../lib/services";
import { auth } from "../../../lib/auth";
import { getAvailableProducts, getOrCreateCurrentSubscription, stripe } from "../../../lib/stripe";
import { getLog, requireDefined } from "juava";
import { withErrorHandler } from "../../../lib/error-handler";

const log = getLog("/api/billing/create");

export type ErrorResponse = {
  ok: false;
  error: string;
};
const handler = async function handler(req: NextApiRequest, res: NextApiResponse<ErrorResponse | undefined>) {
  await store.waitInit();
  if (req.method === "OPTIONS") {
    //allowing requests from everywhere since our tokens are short-lived
    //and can't be hijacked
    return res.status(200).end();
  }
  const planId = requireDefined(req.query.planId as string, `planId parameter is required`);
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

  const { stripeCustomerId } = await getOrCreateCurrentSubscription(
    workspaceId,
    () => requireDefined(req.query.email as string, "email parameter is required"),
    { changeEmail: true }
  );

  const products = await getAvailableProducts();

  const product = requireDefined(
    products.find(p => p.metadata?.jitsu_plan_id === planId),
    `Product with planId ${planId} not found`
  );

  //const prices = await stripe.prices.list({product: product.id, limit: 1});

  const defaultPrice = requireDefined(
    (product.default_price as any)?.id || product.default_price,
    `No default price for ${product.id}`
  );
  const { url } = await stripe.checkout.sessions.create({
    allow_promotion_codes: true,
    payment_method_types: ["card"],
    billing_address_collection: "required",
    mode: "subscription",
    line_items: [{ price: defaultPrice, quantity: 1 }],
    customer: stripeCustomerId,
    success_url: requireDefined(req.query.returnUrl as string, "returnUrl parameter is required"),
    cancel_url: requireDefined(req.query.returnUrl as string, "returnUrl parameter is required"),
  });

  return res.redirect(303, url as string);
};

export default withErrorHandler(handler);
