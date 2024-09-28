import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../../lib/auth";
import { assertTrue, requireDefined } from "juava";
import { withErrorHandler } from "../../../lib/route-helpers";
import { getOrCreateCurrentSubscription } from "../../../lib/stripe";
import { pg } from "../../../lib/services";
import { query } from "../report/workspace-stat";
import { getServerLog } from "../../../lib/log";

//A little copy-paste doesn't hurt
//Values should be the same as in BillingSettings from webapps/console/lib/schema/index.ts
export const freePlanLimitations = {
  dailyActiveSyncs: 1,
};

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const claims = requireDefined(await auth(req, res), `Auth is required`);
  const workspaceId = requireDefined(req.query.workspaceId as string, "workspaceId GET param is required");
  const trigger = req.query.trigger as string;
  assertTrue(claims.type === "admin" || claims.workspaceId === workspaceId, "Invalid auth claims");
  const subscription = await getOrCreateCurrentSubscription(workspaceId, () => {
    throw new Error(
      `Email factory should not be called. When /quotas/sync is called, the subscription should already exist`
    );
  });
  if (subscription.subscriptionStatus.planId !== "free" || subscription.noRestrictions) {
    return { ok: true };
  } else {
    if (subscription.subscriptionStatus.planId === "free" && trigger === "scheduled") {
      return {
        ok: false,
        error: `Scheduled syncs are not supported for free plan. Please upgrade your plan to enable scheduled syncs.`,
      };
    }
    const res = await query(
      pg,
      `
            select
                "workspaceId",
                count(distinct sync."fromId" || sync."toId") as "activeSyncs",
                max(started_at) as "lastSync"
            from newjitsu.source_task task
                 join newjitsu."ConfigurationObjectLink" sync on task.sync_id = sync."id"
            where (task.status = 'SUCCESS' OR task.status = 'PARTIAL') and "workspaceId" = :workspaceId
              and started_at > now() - interval '24 hour'
            and deleted = false
            group by "workspaceId";`,
      { workspaceId }
    );
    getServerLog()
      .atInfo()
      .log(`Quota check for ${workspaceId}: ${JSON.stringify(res, null, 2)}`);
    if (res.length == 0) {
      return { ok: true };
    } else {
      const activeSyncs = res[0].activeSyncs;
      if (activeSyncs >= freePlanLimitations.dailyActiveSyncs) {
        return {
          ok: false,
          error: `Daily active syncs limit exceeded. Syncs in last 24 hours: ${activeSyncs}, limit: ${
            freePlanLimitations.dailyActiveSyncs
          }. Last sync completed at: ${new Date(res[0].lastSync).toISOString()}`,
        };
      }
    }
  }
  return { ok: true };
};

export default withErrorHandler(handler);
