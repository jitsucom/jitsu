import { NextApiRequest, NextApiResponse } from "next";
import { auth, requireWorkspaceAccess } from "../../../lib/auth";
import { requireDefined } from "juava";
import { withBrowserApi } from "../../../lib/route-helpers";
import { SubscriptionStatus, getOrCreateCurrentSubscription } from "../../../lib/stripe";

export type SuccessfullResponse = {
  ok: true;
  stripeCustomerId: string;
  subscriptionStatus: SubscriptionStatus;
  noRestrictions: boolean;
};

export type ErrorResponse = {
  ok: false;
  error: string;
};

const handler = async function handler(req: NextApiRequest, res: NextApiResponse<SuccessfullResponse | ErrorResponse>) {
  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  const workspaceId = req.query.workspaceId as string;
  await requireWorkspaceAccess(claims, workspaceId);

  const customer = await getOrCreateCurrentSubscription(workspaceId, () =>
    requireDefined(req.query.email as string, `email is required`)
  );

  return res.status(200).json({
    ok: true,
    ...customer,
    noRestrictions: !!customer.noRestrictions,
  });
};

export default withBrowserApi(handler);
