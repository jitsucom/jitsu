import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import { auth } from "../../lib/auth";
import { requireDefined } from "juava";
import { pg } from "../../lib/services";
import { sendWorkspaceEmail } from "./email";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const claims = await auth(req, res);
  if (claims?.type !== "admin") {
    throw new Error("Unauthorized");
  }
  const workspaceIdOrSlug = requireDefined(req.query.workspace, `workspace id is required`) as string;
  const throttle = parseInt(requireDefined(req.query.throttle, `Throttle is required`) as string);
  const { id: workspaceId, featuresEnabled } = (
    await pg.query(`select id, "featuresEnabled" from newjitsu."Workspace" where id = $1 or slug = $1`, [
      workspaceIdOrSlug,
    ])
  )?.rows[0];
  if (!workspaceId) {
    throw new Error(`Workspace not found: ${workspaceIdOrSlug}`);
  }
  const featuresWithoutThrottle = featuresEnabled.filter(f => !f.startsWith("throttle"));
  const newFeatures = throttle > 0 ? [...featuresWithoutThrottle, `throttle=${throttle}`] : featuresWithoutThrottle;
  await pg.query(`update newjitsu."Workspace" set "featuresEnabled" = $1 where id = $2`, [newFeatures, workspaceId]);

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
