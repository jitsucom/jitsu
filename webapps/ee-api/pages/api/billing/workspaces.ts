import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../../lib/auth";
import { assertDefined, assertTrue, requireDefined } from "juava";
import { withErrorHandler } from "../../../lib/route-helpers";
import { store } from "../../../lib/services";
import { getStripeObjectTag, listAllSubscriptions, stripe, stripeDataTable, stripeLink } from "../../../lib/stripe";
import Stripe from "stripe";
import { omit } from "lodash";

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
          obj: await store.getTable(stripeDataTable).get(workspaceId),
        },
      ]
    : await store.getTable(stripeDataTable).list();

  const subscriptions: Record<string, Stripe.Subscription[]> = (await listAllSubscriptions()).reduce((acc, sub) => {
    let customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    acc[customerId] = [...(acc[customerId] || []), sub];
    return acc;
  }, {});
  const subscriptionList = Object.values(subscriptions).flat();

  const sub2product = new Map<string, Stripe.Product>();
  for (const sub of subscriptionList) {
    const productId = sub.items.data[0].price.product;
    assertDefined(productId, `Can't get product from subscription ${sub.id}`);
    assertTrue(typeof productId === "string", `Subscription ${sub.id} should have a string product id`);
    const product = await stripe.products.retrieve(productId as string);
    assertDefined(product, `Can't get product ${productId} from subscription ${sub.id}. Product doesn't exist`);
    sub2product.set(sub.id, product);
  }

  const result = Object.fromEntries(
    allWorkspaces
      .map(w => {
        if (w.obj.customBilling) {
          return [
            w.id,
            {
              planId: "enterprise",
              planName: "enterprise",
              pastDue: false,
            },
          ];
        } else if (w.obj.noRestrictions) {
          return [
            w.id,
            {
              planId: "billing-disabled",
              planName: "Billing Disabled",
              pastDue: false,
            },
          ];
        }

        const customerSubscriptions = subscriptions[w.obj.stripeCustomerId];
        if (!customerSubscriptions) {
          return [w.id, undefined];
        }
        const activeSubscription = customerSubscriptions.find(sub => {
          const product = requireDefined(sub2product.get(sub.id), `Can't find product for subscription ${sub.id}`);
          return sub.status === "active" && product.metadata?.object_tag === getStripeObjectTag();
        });
        const pastDueSubscription = customerSubscriptions.find(sub => {
          const product = requireDefined(sub2product.get(sub.id), `Can't find product for subscription ${sub.id}`);
          return sub.status === "past_due" && product.metadata?.object_tag === getStripeObjectTag();
        });
        const subscription = activeSubscription || pastDueSubscription;
        if (!subscription) {
          return [w.id, undefined];
        }

        const product = sub2product.get(subscription.id)!;
        return [
          w.id,
          {
            planId: requireDefined(product?.metadata?.jitsu_plan_id),
            planName: product.name,
            expiresAt: new Date(subscription.current_period_end * 1000).toISOString(),
            renewAfterExpiration: !subscription.cancel_at_period_end,
            pastDue: pastDueSubscription && !activeSubscription,
            subscriptionId: subscription.id,
            customerId: w.obj.stripeCustomerId,
            customerLink: stripeLink("customers", w.obj.stripeCustomerId),
            subscriptionLink: stripeLink("subscriptions", subscription.id),
          },
        ];
      })
      .filter(([, subscription]) => !!subscription)
  );
  res.status(200).json(result);
};

export default withErrorHandler(handler);
