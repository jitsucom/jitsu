import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import { auth } from "../../lib/auth";
import { requireDefined } from "juava";
import { sendWorkspaceEmail } from "./email";
import { setWorkspaceThrottle } from "../../lib/workspaces";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const claims = await auth(req, res);
  if (claims?.type !== "admin") {
    throw new Error("Unauthorized");
  }
  const workspaceIdOrSlug = requireDefined(req.query.workspace, `workspace id is required`) as string;
  const throttle = parseInt(requireDefined(req.query.throttle, `Throttle is required`) as string);
  const { workspaceId, featuresEnabled, featuresWithoutThrottle, newFeatures } = await setWorkspaceThrottle(
    workspaceIdOrSlug,
    throttle
  );

  if (throttle > 0) {
    await sendWorkspaceEmail({
      workspaceId: workspaceId,
      template: "throttling-started",
      variables: { throttled: throttle },
    });
  }

  res.json({ workspaceId, newFeatures, featuresEnabled, featuresWithoutThrottle });
};

export default withErrorHandler(handler);
