import { NextApiRequest, NextApiResponse } from "next";
import { auth } from "../../../lib/auth";
import { requireDefined } from "juava";
import { withErrorHandler } from "../../../lib/route-helpers";
import { SubscriptionStatus, getOrCreateCurrentSubscription } from "../../../lib/stripe";
import { getBillingGroup } from "../../../lib/billing-hierarchy";
import { getEventsReport } from "../report/workspace-stat";
import { pg } from "../../../lib/services";
import { getServerLog } from "../../../lib/log";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

const log = getServerLog("/api/billing/settings");

/** Consolidated usage of a billing group over the current billing period. */
export type GroupUsage = {
  events: number;
  syncs: number;
  periodStart: string;
  periodEnd: string;
  /** Number of workspaces summed — 1 for a standalone workspace. */
  memberCount: number;
};

export type SuccessfullResponse = {
  ok: true;
  stripeCustomerId: string;
  subscriptionStatus: SubscriptionStatus;
  noRestrictions: boolean;
  /** Present only when the request carries `?withUsage=true`. */
  usage?: GroupUsage;
};

export type ErrorResponse = {
  ok: false;
  error: string;
};

/**
 * Sum events and active syncs across a workspace's billing group for the current
 * billing period. For a standalone workspace the group is just itself; for a
 * billing parent it is the parent plus all of its children.
 */
async function getGroupUsage(workspaceId: string, subscription: SubscriptionStatus): Promise<GroupUsage> {
  const period = subscription.currentPeriod;
  const periodStart = period ? new Date(period.start) : dayjs().utc().startOf("month").toDate();
  const periodEnd = period ? new Date(period.end) : dayjs().utc().endOf("month").toDate();
  const start = periodStart.toISOString();
  const end = periodEnd.toISOString();

  const { memberWorkspaceIds } = await getBillingGroup(workspaceId);

  const [eventReports, syncRes] = await Promise.all([
    Promise.all(memberWorkspaceIds.map(id => getEventsReport({ start, end, granularity: "day", workspaceId: id }))),
    pg.query(
      `select count(distinct sync."fromId" || sync."toId") as "activeSyncs"
         from newjitsu.source_task task
              join newjitsu."ConfigurationObjectLink" sync on task.sync_id = sync."id"
        where (task.status = 'SUCCESS' OR task.status = 'PARTIAL')
          and sync."workspaceId" = any($1)
          and started_at >= $2 and started_at < $3`,
      [memberWorkspaceIds, start, end]
    ),
  ]);

  return {
    events: eventReports.flat().reduce((sum, row) => sum + row.events, 0),
    syncs: Number(syncRes.rows[0]?.activeSyncs ?? 0),
    periodStart: start,
    periodEnd: end,
    memberCount: memberWorkspaceIds.length,
  };
}

const handler = async function handler(req: NextApiRequest, res: NextApiResponse<SuccessfullResponse | ErrorResponse>) {
  if (req.method === "OPTIONS") {
    //allowing requests from everywhere since our tokens are short-lived
    //and can't be hijacked
    return res.status(200).end();
  }
  const claims = await auth(req, res);
  if (!claims) {
    return;
  }
  if (claims.type === "user" && claims.workspaceId !== req.query.workspaceId) {
    const msq = `Claimed workspaceId ${claims.workspaceId} does not match requested workspaceId ${req.query.workspaceId}`;
    log.atError().log(msq);
    return res.status(400).json({ ok: false, error: msq });
  }

  const workspaceId = req.query.workspaceId as string;

  const customer = await getOrCreateCurrentSubscription(workspaceId, () =>
    requireDefined(req.query.email as string, `email is required`)
  );

  const usage =
    req.query.withUsage === "true" ? await getGroupUsage(workspaceId, customer.subscriptionStatus) : undefined;

  return res.status(200).json({
    ok: true,
    ...customer,
    noRestrictions: !!customer.noRestrictions,
    ...(usage ? { usage } : {}),
  });
};

export default withErrorHandler(handler);
