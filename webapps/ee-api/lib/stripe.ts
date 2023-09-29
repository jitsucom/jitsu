import Stripe from "stripe";
import { store } from "./services";
import { assertDefined, assertTrue, requireDefined } from "juava";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2022-11-15",
  appInfo: {
    name: "Jitsu Cloud v2 Billing service",
    version: "0.2.0",
  },
});

export const stripeDataTable =
  (process.env.STRIPE_SECRET_KEY as string)?.indexOf("_live_") >= 0 ? "stripe-settings" : "stripe-settings-test-mode";

export type SubscriptionStatus = {
  planId: string;
  expiresAt?: string;
  renewAfterExpiration?: boolean;
} & Record<string, any>;

export async function getOrCreateCurrentSubscription(
  workspaceId: string,
  userEmail: () => string,
  opts: { changeEmail?: boolean } = {}
): Promise<{ stripeCustomerId: string; noRestrictions?: boolean; subscriptionStatus: SubscriptionStatus }> {
  let stripeOptions = await store().getTable(stripeDataTable).get(workspaceId);
  if (!stripeOptions) {
    const email = userEmail();
    const newCustomer = await stripe.customers.create({ email });
    await store().getTable(stripeDataTable).put(workspaceId, { stripeCustomerId: newCustomer.id });
    stripeOptions = { stripeCustomerId: newCustomer.id };
  }
  if (opts.changeEmail) {
    await stripe.customers.update(stripeOptions.stripeCustomerId, { email: userEmail() });
  }
  const plan = (await getActivePlan(stripeOptions.stripeCustomerId)) || { planId: "free" };
  return {
    stripeCustomerId: stripeOptions.stripeCustomerId,
    noRestrictions: !!stripeOptions.noRestrictions,
    subscriptionStatus: {
      ...plan,
      ...(stripeOptions.customSettings || {}),
    },
  };
}

export async function getActivePlan(customerId: string): Promise<null | SubscriptionStatus> {
  const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  const sub2product = new Map<string, Stripe.Product>();
  for (const sub of subscriptions.data) {
    const productId = sub.items.data[0].price.product;
    assertDefined(productId, `Can't get product from subscription ${sub.id}`);
    assertTrue(typeof productId === "string", `Subscription ${sub.id} should have a string product id`);
    const product = await stripe.products.retrieve(productId as string);
    assertDefined(product, `Can't get product ${productId} from subscription ${sub.id}. Product doesn't exist`);
    sub2product.set(sub.id, product);
  }
  //fist, look for active non-legacy plans
  const activeSubscription = subscriptions.data.find(sub => {
    const product = requireDefined(sub2product.get(sub.id), `Can't find product for subscription ${sub.id}`);
    return sub.status === "active" || product.metadata?.object_tag === getStripeObjectTag();
  });
  const pastDueSubscription = subscriptions.data.find(sub => {
    const product = requireDefined(sub2product.get(sub.id), `Can't find product for subscription ${sub.id}`);
    return sub.status === "past_due" || product.metadata?.object_tag === getStripeObjectTag();
  });
  const subscription = activeSubscription || pastDueSubscription;
  if (subscription) {
    const product = requireDefined(
      sub2product.get(subscription.id),
      `Can't find product for subscription ${subscription.id}`
    );
    return {
      planId: requireDefined(product.metadata?.jitsu_plan_id),
      planName: product.name,
      expiresAt: new Date(subscription.current_period_end * 1000).toISOString(),
      renewAfterExpiration: !subscription.cancel_at_period_end,
      pastDue: pastDueSubscription && !activeSubscription,
      ...JSON.parse(requireDefined(product.metadata?.plan_data, `Can't find plan data for product ${product.id}`)),
    };
  }
  //second, look for just cancelled non-legacy plans
  const pastDue = subscriptions.data.find(sub => {
    const product = requireDefined(sub2product.get(sub.id), `Can't find product for subscription ${sub.id}`);
    if (
      sub.status === "past_due" &&
      product.metadata?.object_tag === getStripeObjectTag() &&
      sub.cancel_at_period_end
    ) {
      return product;
    }
  });
  //todo - look for legacy plans
  return null;
}

function getStripeObjectTag() {
  return (process.env.STRIPE_OBJECT_TAG as string) || "jitsu2.0";
}

export async function getAvailableProducts() {
  const stripeObjectTag = getStripeObjectTag();
  const products = (await stripe.products.list({ limit: 100 })).data.filter(
    p => p.metadata?.object_tag === stripeObjectTag
  );
  if (products.length === 0) {
    throw new Error(`No products with tag ${stripeObjectTag} found`);
  }
  return products;
}

export async function getOrCreatePortalConfiguration() {
  const configurations = await stripe.billingPortal.configurations.list({ limit: 10 });
  const stripeObjectTag = getStripeObjectTag();
  const configuration = configurations.data.find(
    configuration => configuration.metadata?.object_tag === stripeObjectTag
  );
  const products = await getAvailableProducts();
  const allowedProducts = products.map(p => ({ product: p.id, prices: [p.default_price] }));
  const customerPortalConfig = {
    business_profile: {
      headline: "Jitsu.Cloud",
      privacy_policy_url: "https://jitsu.com/privacy",
      terms_of_service_url: "https://jitsu.com/tos",
    },
    features: {
      subscription_pause: {
        enabled: false,
      },
      subscription_cancel: {
        enabled: true,
        cancellation_reason: {
          enabled: true,
          options: [
            "customer_service",
            "low_quality",
            "missing_features",
            "other",
            "switched_service",
            "too_complex",
            "too_expensive",
            "unused",
          ],
        },
      },
      customer_update: {
        enabled: true,
        allowed_updates: ["address", "email", "name", "phone"],
      },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_update: {
        default_allowed_updates: ["price"],
        enabled: true,
        products: allowedProducts,
        proration_behavior: "always_invoice",
      },
    },

    metadata: {
      customer_portal_tag: stripeObjectTag,
    },
  };
  let configurationId = configuration?.id;
  if (!configuration) {
    configurationId = (await stripe.billingPortal.configurations.create(customerPortalConfig as any)).id;
  } else {
    await stripe.billingPortal.configurations.update(configuration.id, customerPortalConfig as any);
  }
  return configurationId;
}
