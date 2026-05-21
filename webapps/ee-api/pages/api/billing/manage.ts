import { NextApiRequest, NextApiResponse } from "next";
import { auth, requireWorkspaceAccess } from "../../../lib/auth";
import { requireDefined } from "juava";
import { withBrowserApi } from "../../../lib/route-helpers";
import { getOrCreatePortalConfiguration, getOrCreateCurrentSubscription, stripe } from "../../../lib/stripe";

export type SuccessfullResponse = {
  ok: true;
  url: string;
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

  const { stripeCustomerId } = await getOrCreateCurrentSubscription(workspaceId, () =>
    requireDefined(req.query.email as string, "email parameter is required")
  );

  const configurationId = await getOrCreatePortalConfiguration();

  const { url } = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    configuration: configurationId,

    return_url: requireDefined(req.query.returnUrl as string, "returnUrl parameter is required"),
  });

  //the browser calls this directly (cross-origin) and navigates to `url` itself
  return { ok: true, url };
};

export default withBrowserApi(handler);
