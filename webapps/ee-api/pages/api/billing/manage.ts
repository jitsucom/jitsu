import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../../lib/auth";
import { requireDefined } from "juava";
import { withErrorHandler } from "../../../lib/error-handler";
import { getOrCreatePortalConfiguration, getOrCreateCurrentSubscription, stripe } from "../../../lib/stripe";
import { getServerLog } from "../../../lib/log";

const log = getServerLog("/api/billing/manager");

export type SuccessfullResponse = {
  ok: true;
  url: string;
};

export type ErrorResponse = {
  ok: false;
  error: string;
};

const handler = async function handler(req: NextApiRequest, res: NextApiResponse<SuccessfullResponse | ErrorResponse>) {
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

  const configurationId = await getOrCreatePortalConfiguration();

  const { url } = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    configuration: configurationId,

    return_url: requireDefined(req.query.returnUrl as string, "returnUrl parameter is required"),
  });

  return res.redirect(303, url);
};

export default withErrorHandler(handler);
