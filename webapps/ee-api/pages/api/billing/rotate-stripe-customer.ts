import { NextApiRequest, NextApiResponse } from "next";
import { ErrorResponse } from "./plans";
import assert from "assert";
import { auth } from "../../../lib/auth";
import { rotateStripeCustomer } from "../../../lib/stripe";
import { withErrorHandler } from "../../../lib/error-handler";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const workspaceId = req.query.workspaceId as string | undefined;
  const dryRun = req.query.dryRun === "true" || req.query.dryRun === "1";
  assert(workspaceId, "workspaceId is required");
  const claims = await auth(req, res);
  if (!claims || claims.type !== "admin") {
    return;
  }
  await rotateStripeCustomer(workspaceId, dryRun);
  res.status(200).json({ ok: true });
};

export default withErrorHandler(handler);
