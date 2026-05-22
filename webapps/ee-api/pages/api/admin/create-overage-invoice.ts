import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { buildAdminWorkspaces } from "../../../lib/admin-workspaces";
import { createOverageInvoice, periodKey } from "../../../lib/overage-invoices";

/** Building the overview to recompute overage fans out to Stripe — give it room. */
export const config = {
  maxDuration: 180,
};

/**
 * Create a draft Stripe overage invoice for a workspace's previous billing
 * period and record it in `overage_invoices`. The overage is recomputed
 * server-side from authoritative data — the client only names the workspace and
 * (optionally) the period it expects, which guards against a stale click.
 */
export default withFirebaseAdminAuth(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const workspaceId: unknown = req.body?.workspaceId;
  if (typeof workspaceId !== "string" || !workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  const requestedPeriod: unknown = req.body?.period;

  const overview = await buildAdminWorkspaces({ withOverageInvoices: false });
  const row = overview.rows.find(r => r.workspaceId === workspaceId);
  if (!row) {
    res.status(404).json({ error: `Workspace ${workspaceId} not found` });
    return;
  }
  if (!row.paid) {
    res.status(400).json({ error: "Overage invoices are only created for paid workspaces" });
    return;
  }
  if (!row.stripeCustomerId) {
    res.status(400).json({ error: "Workspace has no Stripe customer" });
    return;
  }

  const expectedPeriod = periodKey(row.previousPeriodStart, row.previousPeriodEnd);
  if (typeof requestedPeriod === "string" && requestedPeriod && requestedPeriod !== expectedPeriod) {
    res.status(409).json({ error: `Period ${requestedPeriod} is stale; current previous period is ${expectedPeriod}` });
    return;
  }

  const overage = row.previousOverage;
  if (!overage || overage.totalFee <= 0) {
    res.status(400).json({ error: "Workspace has no overage for the previous period" });
    return;
  }

  return await createOverageInvoice({
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    stripeCustomerId: row.stripeCustomerId,
    periodStartIso: row.previousPeriodStart,
    periodEndIso: row.previousPeriodEnd,
    eventsOver: overage.eventsOver,
    eventsFee: overage.eventsFee,
    syncsOver: overage.syncsOver,
    syncsFee: overage.syncsFee,
  });
});
