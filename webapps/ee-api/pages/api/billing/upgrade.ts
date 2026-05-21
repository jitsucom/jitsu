import { NextApiRequest, NextApiResponse } from "next";
import { auth, requireWorkspaceAccess } from "../../../lib/auth";
import { getActivePlan, getAvailableProducts, getOrCreateCurrentSubscription, stripe } from "../../../lib/stripe";
import { requireDefined } from "juava";
import { withBrowserApi } from "../../../lib/route-helpers";

export type ErrorResponse = {
  ok: false;
  error: string;
};
const handler = async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: true; url: string } | ErrorResponse>
) {
  const planId = requireDefined(req.query.planId as string, `planId parameter is required`);
  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  const workspaceId = req.query.workspaceId as string;
  await requireWorkspaceAccess(claims, workspaceId);

  const { stripeCustomerId } = await getOrCreateCurrentSubscription(
    workspaceId,
    () => requireDefined(req.query.email as string, "email parameter is required"),
    { changeEmail: true }
  );
  const activeSubscription = await getActivePlan(stripeCustomerId);
  if (activeSubscription) {
    throw new Error(
      `Customer already has an active subscription. Ref: customer - ${stripeCustomerId} / subscription - ${
        activeSubscription.subscriptionId || "unknown"
      }`
    );
  }

  const products = await getAvailableProducts({ custom: true });

  const product = requireDefined(
    products.find(p => p.metadata?.jitsu_plan_id === planId),
    `Product with planId ${planId} not found`
  );

  //const prices = await stripe.prices.list({product: product.id, limit: 1});

  const defaultPrice = requireDefined(
    (product.default_price as any)?.id || product.default_price,
    `No default price for ${product.id}`
  );
  const returnUrl = requireDefined(req.query.returnUrl as string, "returnUrl parameter is required");
  const { url } = await stripe.checkout.sessions.create({
    allow_promotion_codes: true,
    payment_method_types: ["card"],
    billing_address_collection: "required",
    consent_collection: {
      promotions: "none",
      terms_of_service: "required",
    },
    mode: "subscription",
    line_items: [{ price: defaultPrice, quantity: 1 }],
    customer: stripeCustomerId,
    customer_update: {
      address: "auto",
      name: "auto",
    },
    success_url: returnUrl,
    cancel_url: (req.query.cancelUrl as string | undefined) || returnUrl,
  });

  //the browser calls this directly (cross-origin) and navigates to `url` itself
  return { ok: true, url: requireDefined(url, "Stripe did not return a checkout url") };
};

export default withBrowserApi(handler);
