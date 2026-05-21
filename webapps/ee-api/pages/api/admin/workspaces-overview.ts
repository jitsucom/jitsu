import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { buildAdminWorkspaces } from "../../../lib/admin-workspaces";

/**
 * Building the overview fans out to Stripe and stat_cache — give it room.
 * `responseLimit: false` because the whole-fleet table is intentionally large
 * (one row per workspace, several thousand) and exceeds the 4MB soft limit.
 */
export const config = {
  maxDuration: 180,
  responseLimit: false,
};

/**
 * Workspace overview for the admin table: billing status, current period,
 * usage, overage and sync stats. Event stats come from `stat_cache` only.
 */
export default withFirebaseAdminAuth(async () => {
  return await buildAdminWorkspaces();
});
