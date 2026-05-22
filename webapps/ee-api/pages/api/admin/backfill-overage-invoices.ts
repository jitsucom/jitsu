import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { backfillOverageInvoices } from "../../../lib/overage-invoices";

/** Paging through several months of Stripe invoices — give it room. */
export const config = {
  maxDuration: 180,
};

/**
 * Backfill `overage_invoices` from Stripe: scan invoices from the last `months`
 * (query/body param, default 6, capped at 24) and record every overage invoice.
 */
export default withFirebaseAdminAuth(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const raw = req.query.months ?? req.body?.months;
  const months = Math.min(24, Math.max(1, parseInt(String(raw ?? "6"), 10) || 6));
  return await backfillOverageInvoices(months);
});
