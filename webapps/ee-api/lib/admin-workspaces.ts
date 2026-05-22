import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import Stripe from "stripe";
import { getServerLog } from "./log";
import { pg, prisma, store } from "./services";
import {
  getAvailableProducts,
  getStripeObjectTag,
  listAllSubscriptions,
  stripe,
  StripeDataTableEntry,
  stripeDataTable,
  stripeLink,
} from "./stripe";

dayjs.extend(utc);

const log = getServerLog("admin-workspaces");

/** Free-plan monthly event quota — mirrors `destinationEvensPerMonth` default in console billing schema. */
export const FREE_PLAN_EVENTS_QUOTA = 200_000;
/** Default per-extra-active-sync price ($) — mirrors `dailyActiveSyncsOverage` default in console billing schema. */
const DEFAULT_SYNC_OVERAGE_PRICE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How far back raw stat_cache rows are loaded. Covers today, yesterday, the
 * 30-day average and both the current and previous monthly billing periods
 * (≤2 months). Periods that start earlier (annual subscriptions) are summed
 * with a targeted aggregate query.
 */
const RAW_WINDOW_DAYS = 66;

export type WorkspaceStatus =
  | "PAYING"
  | "CANCELLING"
  | "PAST_DUE"
  | "ENTERPRISE"
  | "BILLING_DISABLED"
  | "FREE"
  | "QUOTA_EXCEEDED"
  | "QUOTA_ABOUT_TO_EXCEED";

/** Revenue-generating statuses — used as the primary sort key (paying on top). */
const PAID_STATUSES: ReadonlySet<WorkspaceStatus> = new Set<WorkspaceStatus>([
  "PAYING",
  "CANCELLING",
  "PAST_DUE",
  "ENTERPRISE",
]);

export type PlanInfo = {
  planId: string | null;
  planName: string | null;
  planKind: string | null;
  /** Base fee in dollars for one billing interval; null when unknown (enterprise / free). */
  baseFee: number | null;
  billingInterval: "day" | "week" | "month" | "year" | null;
  /** Included events per period. null = unlimited / not applicable. */
  eventsQuota: number | null;
  /** Overage price per 100k events, dollars. */
  overagePricePer100k: number | null;
  /** Included active syncs. */
  syncsLimit: number | null;
  /** Price per extra active sync, dollars. */
  syncOveragePrice: number | null;
  /** Stripe coupon discount applied to the subscription, percent (0 = none). */
  discountPercent: number;
};

export type OverageInfo = {
  quota: number;
  /** Overage events so far this period: max(0, period − quota). */
  currentEvents: number;
  /** Projected overage events for the full period. */
  projectedEvents: number;
  currentFee: number;
  projectedFee: number;
};

/** Combined overage billed for a completed (previous) period: events + syncs. */
export type PreviousOverageInfo = {
  /** Overage events beyond the included quota. */
  eventsOver: number;
  /** Event overage fee, dollars. */
  eventsFee: number;
  /** Active syncs over the included limit. */
  syncsOver: number;
  /** Sync overage fee, dollars. */
  syncsFee: number;
  /** eventsFee + syncsFee. */
  totalFee: number;
};

export type SyncsInfo = {
  /** Distinct active syncs in the last 31 days. */
  active: number;
  limit: number | null;
  overLimit: number;
  overageFee: number;
};

export type AdminWorkspaceRow = {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string | null;
  status: WorkspaceStatus;
  /** True for revenue-generating statuses. */
  paid: boolean;
  /** Ingest throttle percent (0 = not throttled), parsed from `featuresEnabled`. */
  throttle: number;
  periodStart: string;
  periodEnd: string;
  previousPeriodStart: string;
  previousPeriodEnd: string;
  events: {
    today: number;
    yesterday: number;
    avg30: number;
    /** Last 30 full days of event counts, oldest first, ending yesterday — for the sparkline. */
    daily: number[];
    /** Events consumed so far this period. */
    period: number;
    /** Projected events for the full period. */
    projectedPeriod: number;
    /** Events consumed in the previous (completed) period. */
    previousPeriod: number;
  };
  plan: PlanInfo;
  overage: OverageInfo | null;
  /** Combined overage for the previous period — null for non-paid workspaces. */
  previousOverage: PreviousOverageInfo | null;
  syncs: SyncsInfo;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerLink: string | null;
  stripeSubscriptionLink: string | null;
};

export type AdminWorkspacesResponse = {
  rows: AdminWorkspaceRow[];
  /** Latest day present in stat_cache — the data-freshness marker. */
  statCacheUpdatedAt: string | null;
  generatedAt: string;
  /** Base URL of the console app, for building workspace links. */
  appBaseUrl: string;
  freePlanEventsQuota: number;
};

type RawPlanData = {
  planKind?: string;
  planName?: string;
  destinationEvensPerMonth?: number;
  overagePricePer100k?: number;
  dailyActiveSyncs?: number;
  dailyActiveSyncsOverage?: number;
};

function parsePlanData(metadata: Stripe.Metadata | null | undefined): RawPlanData {
  try {
    return metadata?.plan_data ? JSON.parse(metadata.plan_data) : {};
  } catch (e) {
    log.atWarn().withCause(e).log("Failed to parse stripe product plan_data");
    return {};
  }
}

/** Ingest throttle percent stored as a `throttle=NN` entry in `featuresEnabled`. */
function parseThrottle(featuresEnabled: string[] | null | undefined): number {
  const feature = (featuresEnabled || []).find(f => f.startsWith("throttle"));
  if (!feature) {
    return 0;
  }
  const value = parseInt(feature.replace("throttle", "").replace("=", ""), 10);
  return isNaN(value) ? 0 : value;
}

/** Sum events for the inclusive day range [from, to] from a pre-loaded day → events map. */
function sumDays(dayMap: Map<string, number>, from: Dayjs, to: Dayjs): number {
  let sum = 0;
  let day = from.startOf("day");
  const end = to.startOf("day");
  while (!day.isAfter(end)) {
    sum += dayMap.get(day.format("YYYY-MM-DD")) || 0;
    day = day.add(1, "day");
  }
  return sum;
}

/**
 * Current billing period for a custom-billed (enterprise) workspace, derived
 * from its anchor day-of-month. Mirrors `getOrCreateCurrentSubscription`.
 * Returns null when the subscription start is still in the future.
 */
function customBillingPeriod(start: string, now: Dayjs): { start: Dayjs; end: Dayjs } | null {
  const startDate = dayjs.utc(`${start}T00:00:00Z`);
  if (startDate.isAfter(now)) {
    return null;
  }
  const anchorDay = startDate.date();
  let expiresAt = now.date(anchorDay).startOf("day");
  if (now.date() > anchorDay) {
    expiresAt = expiresAt.add(1, "month");
  }
  return { start: expiresAt.subtract(1, "month").startOf("day"), end: expiresAt.endOf("day") };
}

/** Extrapolate period-to-date events to the whole period, guarding against a near-zero elapsed window. */
function projectPeriod(periodEvents: number, periodStart: Dayjs, periodEnd: Dayjs, now: Dayjs): number {
  const elapsedMs = Math.max(now.valueOf() - periodStart.valueOf(), DAY_MS);
  const totalMs = Math.max(periodEnd.valueOf() - periodStart.valueOf(), DAY_MS);
  const fraction = Math.min(elapsedMs / totalMs, 1);
  return periodEvents / fraction;
}

type Billing = {
  status: WorkspaceStatus;
  periodStart: Dayjs;
  periodEnd: Dayjs;
  previousPeriodStart: Dayjs;
  previousPeriodEnd: Dayjs;
  plan: PlanInfo;
  subscription: Stripe.Subscription | null;
  customerId: string | null;
};

/** Resolve billing status, current + previous period and plan from the workspace's stripe data. */
function resolveBilling(
  stripeEntry: StripeDataTableEntry | undefined,
  subsByCustomer: Map<string, Stripe.Subscription[]>,
  productById: Map<string, Stripe.Product>,
  now: Dayjs
): Billing {
  const calendarMonth = { start: now.startOf("month"), end: now.endOf("month") };
  // Calendar-month period used for free / billing-disabled workspaces.
  // previousPeriodEnd is exclusive (= current month start) so the window stays
  // half-open [start, end), consistent with Stripe-billed periods.
  const monthPeriod = {
    periodStart: calendarMonth.start,
    periodEnd: calendarMonth.end,
    previousPeriodStart: now.subtract(1, "month").startOf("month"),
    previousPeriodEnd: calendarMonth.start,
  };
  const freePlan: PlanInfo = {
    planId: "free",
    planName: "Free",
    planKind: "self-service",
    baseFee: 0,
    billingInterval: null,
    eventsQuota: FREE_PLAN_EVENTS_QUOTA,
    overagePricePer100k: null,
    syncsLimit: null,
    syncOveragePrice: null,
    discountPercent: 0,
  };

  if (!stripeEntry) {
    return { status: "FREE", ...monthPeriod, plan: freePlan, subscription: null, customerId: null };
  }
  const customerId = stripeEntry.stripeCustomerId || null;

  if (stripeEntry.noRestrictions) {
    return {
      status: "BILLING_DISABLED",
      ...monthPeriod,
      plan: {
        planId: "$admin",
        planName: "Billing Disabled",
        planKind: null,
        baseFee: null,
        billingInterval: null,
        eventsQuota: null,
        overagePricePer100k: null,
        syncsLimit: null,
        syncOveragePrice: null,
        discountPercent: 0,
      },
      subscription: null,
      customerId,
    };
  }

  if (stripeEntry.customBilling) {
    const settings = stripeEntry.customSettings || {};
    const period = customBillingPeriod(stripeEntry.customBilling.start, now);
    if (!period) {
      // Subscription starts in the future — treat as free until then.
      return { status: "FREE", ...monthPeriod, plan: freePlan, subscription: null, customerId };
    }
    return {
      status: "ENTERPRISE",
      periodStart: period.start,
      periodEnd: period.end,
      previousPeriodStart: period.start.subtract(1, "month"),
      previousPeriodEnd: period.start,
      plan: {
        planId: "enterprise",
        planName: settings.planName || "Enterprise",
        planKind: settings.planKind || "enterprise",
        baseFee: typeof settings.baseFee === "number" ? settings.baseFee : null,
        billingInterval: "month",
        eventsQuota: typeof settings.destinationEvensPerMonth === "number" ? settings.destinationEvensPerMonth : null,
        overagePricePer100k: typeof settings.overagePricePer100k === "number" ? settings.overagePricePer100k : null,
        syncsLimit: typeof settings.dailyActiveSyncs === "number" ? settings.dailyActiveSyncs : null,
        syncOveragePrice:
          typeof settings.dailyActiveSyncsOverage === "number"
            ? settings.dailyActiveSyncsOverage
            : DEFAULT_SYNC_OVERAGE_PRICE,
        discountPercent: 0,
      },
      subscription: null,
      customerId,
    };
  }

  // Stripe-managed subscription. Only subscriptions on a known jitsu product count.
  const jitsuSubs = (customerId ? subsByCustomer.get(customerId) || [] : []).filter(s => {
    const productId = s.items.data[0]?.price.product;
    return typeof productId === "string" && productById.has(productId);
  });
  const active = jitsuSubs.find(s => s.status === "active" && !s.cancel_at_period_end);
  const cancelling = jitsuSubs.find(s => s.status === "active" && s.cancel_at_period_end);
  const pastDue = jitsuSubs.find(s => s.status === "past_due");
  const subscription = active || cancelling || pastDue;

  if (!subscription) {
    return { status: "FREE", ...monthPeriod, plan: freePlan, subscription: null, customerId };
  }

  const status: WorkspaceStatus = active ? "PAYING" : cancelling ? "CANCELLING" : "PAST_DUE";
  const product = productById.get(subscription.items.data[0].price.product as string)!;
  const planData = parsePlanData(product.metadata);
  const price = subscription.items.data[0].price;
  const periodStart = dayjs.unix(subscription.current_period_start).utc();
  const periodEnd = dayjs.unix(subscription.current_period_end).utc();
  const interval = price.recurring?.interval || "month";

  return {
    status,
    periodStart,
    periodEnd,
    previousPeriodStart: periodStart.subtract(1, interval),
    previousPeriodEnd: periodStart,
    plan: {
      planId: product.metadata?.jitsu_plan_id || null,
      planName: planData.planName || product.name,
      planKind: planData.planKind || "self-service",
      baseFee: price.unit_amount != null ? price.unit_amount / 100 : null,
      billingInterval: price.recurring?.interval || null,
      eventsQuota: typeof planData.destinationEvensPerMonth === "number" ? planData.destinationEvensPerMonth : null,
      overagePricePer100k: typeof planData.overagePricePer100k === "number" ? planData.overagePricePer100k : null,
      syncsLimit: typeof planData.dailyActiveSyncs === "number" ? planData.dailyActiveSyncs : null,
      syncOveragePrice:
        typeof planData.dailyActiveSyncsOverage === "number"
          ? planData.dailyActiveSyncsOverage
          : DEFAULT_SYNC_OVERAGE_PRICE,
      discountPercent: subscription.discount?.coupon?.percent_off ?? 0,
    },
    subscription,
    customerId,
  };
}

/**
 * Distinct active syncs per workspace within a per-workspace time window —
 * resolved in a single round-trip. Used for previous-period sync overage,
 * where each workspace has its own billing window.
 */
async function activeSyncsInWindows(
  windows: { workspaceId: string; start: Date; end: Date }[]
): Promise<Map<string, number>> {
  if (windows.length === 0) {
    return new Map();
  }
  const valueTuples: string[] = [];
  const params: (string | Date)[] = [];
  windows.forEach((w, i) => {
    const base = i * 3;
    valueTuples.push(`($${base + 1}::text, $${base + 2}::timestamptz, $${base + 3}::timestamptz)`);
    params.push(w.workspaceId, w.start, w.end);
  });
  const result = await pg.query({
    text: `with periods (workspace_id, period_start, period_end) as (values ${valueTuples.join(", ")})
           select p.workspace_id as "workspaceId",
                  count(distinct sync."fromId" || sync."toId") as "activeSyncs"
           from periods p
                join newjitsu."ConfigurationObjectLink" sync
                  on sync."workspaceId" = p.workspace_id and sync.type = 'sync'
           where exists (select 1
                         from newjitsu.source_task task
                         where task.sync_id = sync.id
                           and (task.status = 'SUCCESS' or task.status = 'PARTIAL')
                           and task.started_at >= p.period_start
                           and task.started_at < p.period_end)
           group by p.workspace_id`,
    values: params,
  });
  return new Map(result.rows.map((r: any) => [r.workspaceId as string, Number(r.activeSyncs)]));
}

/**
 * Build the admin workspace overview: billing status, usage, overage and sync
 * stats for every active workspace. All event stats come from the `stat_cache`
 * table — ClickHouse is never queried.
 */
export async function buildAdminWorkspaces(): Promise<AdminWorkspacesResponse> {
  const now = dayjs().utc();
  const rawWindowStart = now.subtract(RAW_WINDOW_DAYS, "day").startOf("day");

  const [workspaceRows, statRows, syncRows, stripeEntries, products, subscriptions] = await Promise.all([
    pg
      .query(`select id, name, slug, "featuresEnabled" from newjitsu."Workspace" where deleted = false`)
      .then(
        r => r.rows as { id: string; name: string | null; slug: string | null; featuresEnabled: string[] | null }[]
      ),
    prisma.statCache.findMany({
      where: { period: { gte: rawWindowStart.toDate() } },
      select: { workspaceId: true, period: true, events: true },
    }),
    pg
      .query(
        `select sync."workspaceId" as "workspaceId",
                count(distinct sync."fromId" || sync."toId") as "activeSyncs"
         from newjitsu."ConfigurationObjectLink" sync
         where sync.type = 'sync'
           and exists (select 1
                       from newjitsu.source_task task
                       where task.sync_id = sync.id
                         and (task.status = 'SUCCESS' or task.status = 'PARTIAL')
                         and task.started_at > now() - interval '31 days')
         group by sync."workspaceId"`
      )
      .then(r => r.rows as { workspaceId: string; activeSyncs: string }[]),
    store.getTable(stripeDataTable).list() as Promise<{ id: string; obj: StripeDataTableEntry }[]>,
    // getAvailableProducts throws when the Stripe catalog is empty/mis-tagged.
    // Degrade gracefully: an empty list still renders free/custom workspaces,
    // and subscription products are resolved individually below.
    getAvailableProducts({ custom: true }).catch(e => {
      log.atWarn().withCause(e).log("Failed to load Stripe product catalog — continuing without it");
      return [] as Stripe.Product[];
    }),
    listAllSubscriptions(),
  ]);

  log
    .atInfo()
    .log(
      `Loaded ${workspaceRows.length} workspaces, ${statRows.length} stat rows, ${stripeEntries.length} stripe entries, ` +
        `${products.length} products, ${subscriptions.length} subscriptions`
    );

  // Events per workspace per day, plus the latest cached day.
  const eventsByWorkspace = new Map<string, Map<string, number>>();
  let statCacheUpdatedAt: Date | null = null;
  for (const row of statRows) {
    const day = dayjs(row.period).utc().format("YYYY-MM-DD");
    let dayMap = eventsByWorkspace.get(row.workspaceId);
    if (!dayMap) {
      eventsByWorkspace.set(row.workspaceId, (dayMap = new Map()));
    }
    dayMap.set(day, (dayMap.get(day) || 0) + Number(row.events));
    if (!statCacheUpdatedAt || row.period > statCacheUpdatedAt) {
      statCacheUpdatedAt = row.period;
    }
  }

  const activeSyncsByWorkspace = new Map(syncRows.map(r => [r.workspaceId, Number(r.activeSyncs)]));
  const stripeByWorkspace = new Map(stripeEntries.map(e => [e.id, e.obj]));
  const productById = new Map(products.map(p => [p.id, p]));
  // getAvailableProducts() only lists the current catalog — a subscription on an
  // archived/retired product would be missing, misclassifying a paid workspace
  // as free. Fetch any such products and keep the ones tagged for this account.
  const stripeObjectTag = getStripeObjectTag();
  const missingProductIds = new Set<string>();
  for (const sub of subscriptions) {
    const productId = sub.items.data[0]?.price.product;
    if (typeof productId === "string" && !productById.has(productId)) {
      missingProductIds.add(productId);
    }
  }
  for (const productId of missingProductIds) {
    try {
      const product = await stripe.products.retrieve(productId);
      if (product.metadata?.object_tag === stripeObjectTag) {
        productById.set(productId, product);
      }
    } catch (e) {
      log.atWarn().withCause(e).log(`Failed to retrieve Stripe product ${productId}`);
    }
  }

  const subsByCustomer = new Map<string, Stripe.Subscription[]>();
  for (const sub of subscriptions) {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const list = subsByCustomer.get(customerId);
    if (list) {
      list.push(sub);
    } else {
      subsByCustomer.set(customerId, [sub]);
    }
  }

  const todayKey = now.format("YYYY-MM-DD");
  const yesterdayKey = now.subtract(1, "day").format("YYYY-MM-DD");

  const rows: AdminWorkspaceRow[] = [];
  // Previous-period sync windows for paid workspaces — resolved in one query below.
  const previousSyncWindows: { workspaceId: string; start: Date; end: Date }[] = [];
  for (const workspace of workspaceRows) {
    const dayMap = eventsByWorkspace.get(workspace.id);
    const stripeEntry = stripeByWorkspace.get(workspace.id);
    // Skip dead workspaces: no billing relationship and no events in the raw window.
    if (!dayMap && !stripeEntry) {
      continue;
    }
    const events = dayMap || new Map<string, number>();
    const billing = resolveBilling(stripeEntry, subsByCustomer, productById, now);

    const today = events.get(todayKey) || 0;
    const yesterday = events.get(yesterdayKey) || 0;
    // Last 30 full days, oldest first, ending yesterday — drives the sparkline.
    const daily: number[] = [];
    for (let d = 30; d >= 1; d--) {
      daily.push(events.get(now.subtract(d, "day").format("YYYY-MM-DD")) || 0);
    }
    const avg30 = daily.reduce((sum, v) => sum + v, 0) / 30;

    // Period-to-date events. Monthly periods fit the raw window; longer (annual)
    // periods fall back to a targeted aggregate over stat_cache.
    const periodCap = billing.periodEnd.isBefore(now) ? billing.periodEnd : now;
    let periodEvents: number;
    if (billing.periodStart.isBefore(rawWindowStart)) {
      const agg = await prisma.statCache.aggregate({
        _sum: { events: true },
        where: {
          workspaceId: workspace.id,
          period: { gte: billing.periodStart.startOf("day").toDate(), lte: periodCap.endOf("day").toDate() },
        },
      });
      periodEvents = Number(agg._sum.events ?? 0);
    } else {
      periodEvents = sumDays(events, billing.periodStart, periodCap);
    }
    const projectedPeriod = projectPeriod(periodEvents, billing.periodStart, billing.periodEnd, now);

    // Previous (completed) period events. The period is [start, end); the end
    // day is the first day of the current period and must be excluded — this
    // mirrors the legacy overage report, which rounds the window to whole days
    // and drops the end day.
    const previousPeriodLastDay = billing.previousPeriodEnd.startOf("day").subtract(1, "day");
    let previousPeriodEvents: number;
    if (billing.previousPeriodStart.isBefore(rawWindowStart)) {
      const agg = await prisma.statCache.aggregate({
        _sum: { events: true },
        where: {
          workspaceId: workspace.id,
          period: {
            gte: billing.previousPeriodStart.startOf("day").toDate(),
            lte: previousPeriodLastDay.endOf("day").toDate(),
          },
        },
      });
      previousPeriodEvents = Number(agg._sum.events ?? 0);
    } else {
      previousPeriodEvents = sumDays(events, billing.previousPeriodStart, previousPeriodLastDay);
    }

    // Overage — only for plans with an explicit event quota. The subscription's
    // Stripe coupon (percent_off) is applied so fees match the invoiced amount.
    let overage: OverageInfo | null = null;
    const { eventsQuota, overagePricePer100k } = billing.plan;
    if (eventsQuota != null && billing.status !== "FREE") {
      const currentEvents = Math.max(0, periodEvents - eventsQuota);
      const projectedEvents = Math.max(0, projectedPeriod - eventsQuota);
      const pricePerEvent = ((overagePricePer100k || 0) / 100_000) * (1 - billing.plan.discountPercent / 100);
      overage = {
        quota: eventsQuota,
        currentEvents,
        projectedEvents,
        currentFee: currentEvents * pricePerEvent,
        projectedFee: projectedEvents * pricePerEvent,
      };
    }

    // Free workspaces: refine status by quota usage.
    let status = billing.status;
    if (status === "FREE") {
      if (periodEvents > FREE_PLAN_EVENTS_QUOTA) {
        status = "QUOTA_EXCEEDED";
      } else if (projectedPeriod > FREE_PLAN_EVENTS_QUOTA) {
        status = "QUOTA_ABOUT_TO_EXCEED";
      }
    }

    // Sync stats.
    const active = activeSyncsByWorkspace.get(workspace.id) || 0;
    const syncLimit = billing.plan.syncsLimit;
    const overLimit = syncLimit != null ? Math.max(0, active - syncLimit) : 0;
    const syncs: SyncsInfo = {
      active,
      limit: syncLimit,
      overLimit,
      overageFee: overLimit * (billing.plan.syncOveragePrice || 0) * (1 - billing.plan.discountPercent / 100),
    };

    const paid = PAID_STATUSES.has(status);
    if (paid) {
      previousSyncWindows.push({
        workspaceId: workspace.id,
        start: billing.previousPeriodStart.toDate(),
        end: billing.previousPeriodEnd.toDate(),
      });
    }

    const subscriptionId = billing.subscription?.id || null;
    rows.push({
      workspaceId: workspace.id,
      workspaceName: workspace.name || workspace.slug || workspace.id,
      workspaceSlug: workspace.slug,
      status,
      paid,
      throttle: parseThrottle(workspace.featuresEnabled),
      periodStart: billing.periodStart.toISOString(),
      periodEnd: billing.periodEnd.toISOString(),
      previousPeriodStart: billing.previousPeriodStart.toISOString(),
      previousPeriodEnd: billing.previousPeriodEnd.toISOString(),
      events: {
        today,
        yesterday,
        avg30,
        daily,
        period: periodEvents,
        projectedPeriod,
        previousPeriod: previousPeriodEvents,
      },
      plan: billing.plan,
      overage,
      previousOverage: null,
      syncs,
      stripeCustomerId: billing.customerId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerLink: billing.customerId ? stripeLink("customers", billing.customerId) : null,
      stripeSubscriptionLink: subscriptionId ? stripeLink("subscriptions", subscriptionId) : null,
    });
  }

  // Previous-period overage = event overage + sync overage, for paid workspaces.
  const previousActiveSyncs = await activeSyncsInWindows(previousSyncWindows);
  for (const row of rows) {
    if (!row.paid) {
      continue;
    }
    const { eventsQuota, overagePricePer100k, syncsLimit, syncOveragePrice, discountPercent } = row.plan;
    const discountFactor = 1 - discountPercent / 100;
    const eventsOver = eventsQuota != null ? Math.max(0, row.events.previousPeriod - eventsQuota) : 0;
    const eventsFee = (eventsOver / 100_000) * (overagePricePer100k || 0) * discountFactor;
    const syncsOver =
      syncsLimit != null ? Math.max(0, (previousActiveSyncs.get(row.workspaceId) || 0) - syncsLimit) : 0;
    const syncsFee = syncsOver * (syncOveragePrice || 0) * discountFactor;
    row.previousOverage = { eventsOver, eventsFee, syncsOver, syncsFee, totalFee: eventsFee + syncsFee };
  }

  log.atInfo().log(`Built admin overview for ${rows.length} workspaces`);

  return {
    rows,
    statCacheUpdatedAt: statCacheUpdatedAt ? statCacheUpdatedAt.toISOString() : null,
    generatedAt: now.toISOString(),
    appBaseUrl: (process.env.JITSU_APPLICATION_URL || "https://use.jitsu.com").replace(/\/$/, ""),
    freePlanEventsQuota: FREE_PLAN_EVENTS_QUOTA,
  };
}
