import { NextApiRequest, NextApiResponse } from "next";
import { auth, requireWorkspaceAccess } from "../../../lib/auth";
import { getAvailableProducts, getOrCreateCurrentSubscription, stripe } from "../../../lib/stripe";
import { requireDefined } from "juava";
import { withBrowserApi } from "../../../lib/route-helpers";

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
  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  const workspaceId = req.query.workspaceId as string;
  await requireWorkspaceAccess(claims, workspaceId);

  const { stripeCustomerId } = await getOrCreateCurrentSubscription(workspaceId, () =>
    requireDefined(req.query.email as string, "email parameter is required")
  );

  const products = await getAvailableProducts();
  const result: Product[] = [];
  for (const product of products) {
    const isLegacy = product.metadata?.is_legacy === "true" || product.metadata?.is_legacy === "1";
    if (isLegacy) {
      continue;
    }
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 10 });
    const monthly = requireDefined(
      prices.data.find(p => p.recurring?.interval === "month"),
      `No monthly price for ${product.id}`
    );
    const annual = prices.data.find(p => p.recurring?.interval === "year");
    const planData = JSON.parse(requireDefined(product.metadata?.plan_data, `No data for ${product.id}`));
    if (!isLegacy) {
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
  }

  return { products: result };
};

export default withBrowserApi(handler);
