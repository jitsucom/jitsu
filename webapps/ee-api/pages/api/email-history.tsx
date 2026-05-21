import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import { requireDefined } from "juava";
import { auth } from "../../lib/auth";
import { getWorkspaceEmailHistory } from "../../lib/email";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const workspaceId = requireDefined(req.query.workspaceId, "workspaceId is required") as string;
  const claims = await auth(req, res);
  if (claims?.type !== "admin") {
    throw new Error("Unauthorized");
  }
  res.json(await getWorkspaceEmailHistory(workspaceId));
};

export default withErrorHandler(handler);
