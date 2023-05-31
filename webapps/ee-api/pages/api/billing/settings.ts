import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../../lib/auth";
import { getLog, requireDefined } from "juava";
import { withErrorHandler } from "../../../lib/error-handler";
import { SubscriptionStatus, getOrCreateCurrentSubscription } from "../../../lib/stripe";
import { store } from "../../../lib/services";

const log = getLog("/api/billing/settings");

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
  await store.waitInit();
  if (req.method === "OPTIONS") {
    //allowing requests from everywhere since our tokens are short-lived
    //and can't be hijacked
    return res.status(200).end();
  }
  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  if (claims.type === "user" && claims.workspaceId !== req.query.workspaceId) {
    const msq = `Claimed workspaceId ${claims.workspaceId} does not match requested workspaceId ${req.query.workspaceId}`;
    log.atError().log(msq);
    return res.status(400).json({ ok: false, error: msq });
  }

  const workspaceId = req.query.workspaceId as string;

  const customer = await getOrCreateCurrentSubscription(workspaceId, () =>
    requireDefined(req.query.email as string, `email is required`)
  );

  return res.status(200).json({
    ok: true,
    ...customer,
    noRestrictions: !!customer.noRestrictions,
  });
};

export default withErrorHandler(handler);
