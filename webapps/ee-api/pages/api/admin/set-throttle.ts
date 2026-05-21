import { z } from "zod";
import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { getWorkspaceThrottle, setWorkspaceThrottle } from "../../../lib/workspaces";
import { sendWorkspaceEmail } from "../email";

const SetThrottleBody = z.object({
  workspaceId: z.string().min(1),
  throttle: z.number().int().min(0).max(100),
});

/**
 * Current throttle percent (GET `?workspaceId=`) and updating it
 * (POST `{ workspaceId, throttle }`). Setting a non-zero throttle also sends
 * the `throttling-started` email to the workspace.
 */
export default withFirebaseAdminAuth(async (req, res) => {
  if (req.method === "GET") {
    const workspaceId = req.query.workspaceId;
    if (typeof workspaceId !== "string" || !workspaceId) {
      res.status(400).json({ error: "workspaceId query param is required" });
      return;
    }
    return await getWorkspaceThrottle(workspaceId);
  }
  if (req.method === "POST") {
    const { workspaceId, throttle } = SetThrottleBody.parse(req.body);
    const result = await setWorkspaceThrottle(workspaceId, throttle);
    if (throttle > 0) {
      await sendWorkspaceEmail({
        workspaceId: result.workspaceId,
        template: "throttling-started",
        variables: { throttled: throttle },
      });
    }
    return result;
  }
  res.status(405).json({ error: "Method not allowed" });
  return;
});
