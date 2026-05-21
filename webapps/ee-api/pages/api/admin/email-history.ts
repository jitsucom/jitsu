import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { getWorkspaceEmailHistory } from "../../../lib/email";

/** Email-sending history for a workspace. Requires `?workspaceId=`. */
export default withFirebaseAdminAuth(async (req, res) => {
  const workspaceId = req.query.workspaceId;
  if (typeof workspaceId !== "string" || !workspaceId) {
    res.status(400).json({ error: "workspaceId query param is required" });
    return;
  }
  return { history: await getWorkspaceEmailHistory(workspaceId) };
});
