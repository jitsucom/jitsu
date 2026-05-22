import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { listBillingParentLinks, removeBillingParent, setBillingParent } from "../../../lib/billing-hierarchy";
import { isWorkspaceOnFreePlan } from "../../../lib/stripe";

/**
 * Admin CRUD for billing-parent links (workspace bills under a parent).
 *
 *  - GET                                  — list every link
 *  - POST   { workspaceId, parentWorkspaceId } — link a child under a parent
 *  - DELETE { workspaceId }               — unlink a child
 */
export default withFirebaseAdminAuth(async (req, res) => {
  if (req.method === "GET") {
    return { links: await listBillingParentLinks() };
  }

  if (req.method === "POST") {
    const { workspaceId, parentWorkspaceId } = req.body || {};
    if (!workspaceId || !parentWorkspaceId) {
      res.status(400).json({ ok: false, error: "workspaceId and parentWorkspaceId are required" });
      return;
    }
    try {
      if (await isWorkspaceOnFreePlan(workspaceId)) {
        throw new Error(
          "The child workspace is on the free plan — only paid workspaces can be joined to a billing group"
        );
      }
      await setBillingParent(workspaceId, parentWorkspaceId);
    } catch (e: any) {
      res.status(400).json({ ok: false, error: e?.message || "Failed to link workspaces" });
      return;
    }
    return { ok: true };
  }

  if (req.method === "DELETE") {
    const { workspaceId } = req.body || {};
    if (!workspaceId) {
      res.status(400).json({ ok: false, error: "workspaceId is required" });
      return;
    }
    await removeBillingParent(workspaceId);
    return { ok: true };
  }

  res.status(405).json({ ok: false, error: `Method ${req.method} not allowed` });
  return;
});
