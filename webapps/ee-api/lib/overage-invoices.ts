import dayjs, { Dayjs } from "dayjs";
import utc from "dayjs/plugin/utc";
import Stripe from "stripe";
import { getServerLog } from "./log";
import { Prisma, prisma, store } from "./services";
import { stripe, stripeDataTable, stripeLink, StripeDataTableEntry } from "./stripe";

dayjs.extend(utc);

const log = getServerLog("overage-invoices");

/** Line description for the event-overage line — matches the manually-created overage invoices in Stripe. */
const EVENTS_LINE_DESCRIPTION = "Overage fee - events over plan limit, per event";
const DAY_FMT = "YYYY-MM-DD";

/**
 * A backfilled overage invoice carries the billing period entered by hand on
 * its Stripe line, which can drift a day or two from the Stripe-derived billing
 * cycle. A stored period whose start is within this many days of the cycle
 * start is treated as the same period.
 */
const PERIOD_MATCH_TOLERANCE_DAYS = 7;

/** Stripe invoice statuses we surface. Voided invoices are filtered out upstream. */
export type OverageInvoiceStatus = "draft" | "open" | "paid" | "uncollectible" | "void";

/** Overage invoice info attached to an admin workspace row. */
export type OverageInvoiceInfo = {
  invoiceId: string;
  /** Period key the invoice is stored under (`YYYY-MM-DD_YYYY-MM-DD`). */
  period: string;
  status: OverageInvoiceStatus;
  /** Stripe dashboard link to the invoice. */
  link: string;
  /** Invoice total in dollars. */
  total: number;
};

/** A row of the `overage_invoices` table. */
type OverageInvoiceRow = { workspaceId: string; period: string; invoiceId: string };

/**
 * Canonical period key for a billing period: `YYYY-MM-DD_YYYY-MM-DD`, start
 * inclusive and end exclusive, both in UTC.
 */
export function periodKey(startIso: string, endIso: string): string {
  return `${dayjs.utc(startIso).format(DAY_FMT)}_${dayjs.utc(endIso).format(DAY_FMT)}`;
}

/** Parse a period key back into UTC day boundaries; null when malformed. */
export function parsePeriodKey(key: string): { start: Dayjs; end: Dayjs } | null {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(key);
  return m ? { start: dayjs.utc(m[1]), end: dayjs.utc(m[2]) } : null;
}

/** All `overage_invoices` rows grouped by workspace id. */
export async function loadOverageInvoiceRows(): Promise<Map<string, OverageInvoiceRow[]>> {
  const rows = await prisma.overageInvoice.findMany({
    select: { workspaceId: true, period: true, invoiceId: true },
  });
  const byWorkspace = new Map<string, OverageInvoiceRow[]>();
  for (const row of rows) {
    const list = byWorkspace.get(row.workspaceId);
    if (list) {
      list.push(row);
    } else {
      byWorkspace.set(row.workspaceId, [row]);
    }
  }
  return byWorkspace;
}

/**
 * Find the stored overage invoice for a workspace's billing period.
 *
 * An exact period-key match always wins. Failing that, the match falls back to
 * a tolerant comparison — a backfilled invoice carries the line period entered
 * by hand on Stripe, which can drift a day or two from the Stripe-derived
 * cycle. The tolerance is capped strictly below half the period length, so it
 * can never reach an adjacent period: weekly periods sit only 7 days apart, and
 * a flat ±7-day window would otherwise let the previous week's invoice match.
 */
export function matchOverageInvoice(
  rows: OverageInvoiceRow[] | undefined,
  periodStartIso: string,
  periodEndIso: string
): OverageInvoiceRow | null {
  if (!rows || rows.length === 0) {
    return null;
  }
  const exactKey = periodKey(periodStartIso, periodEndIso);
  const exact = rows.find(r => r.period === exactKey);
  if (exact) {
    return exact;
  }
  const target = dayjs.utc(periodStartIso);
  // Cap tolerance below half the period length so adjacent periods cannot
  // collide (their starts are a full period length apart).
  const periodDays = Math.max(1, dayjs.utc(periodEndIso).diff(target, "day"));
  const tolerance = Math.min(PERIOD_MATCH_TOLERANCE_DAYS, Math.floor(periodDays / 2) - 1);
  if (tolerance < 1) {
    return null;
  }
  let best: { row: OverageInvoiceRow; diff: number } | null = null;
  for (const row of rows) {
    const parsed = parsePeriodKey(row.period);
    if (!parsed) {
      continue;
    }
    const diff = Math.abs(parsed.start.diff(target, "day"));
    if (diff <= tolerance && (!best || diff < best.diff)) {
      best = { row, diff };
    }
  }
  return best?.row ?? null;
}

/** Retrieve invoices by id, tolerating ones deleted in Stripe. Bounded concurrency. */
async function retrieveInvoices(ids: string[]): Promise<Map<string, Stripe.Invoice>> {
  const result = new Map<string, Stripe.Invoice>();
  const concurrency = 10;
  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const invoices = await Promise.all(
      chunk.map(id =>
        stripe.invoices.retrieve(id).catch(e => {
          log.atWarn().withCause(e).log(`Failed to retrieve overage invoice ${id}`);
          return null;
        })
      )
    );
    for (const inv of invoices) {
      if (inv) {
        result.set(inv.id, inv);
      }
    }
  }
  return result;
}

/**
 * Resolve the current Stripe state of stored overage invoices, keyed by invoice
 * id. Invoices that were deleted or voided in Stripe are omitted — the admin
 * page treats them as "no invoice" and offers a Create button again.
 */
export async function fetchOverageInvoiceInfos(rows: OverageInvoiceRow[]): Promise<Map<string, OverageInvoiceInfo>> {
  const result = new Map<string, OverageInvoiceInfo>();
  if (rows.length === 0) {
    return result;
  }
  const invoices = await retrieveInvoices(rows.map(r => r.invoiceId));
  for (const row of rows) {
    const inv = invoices.get(row.invoiceId);
    if (!inv) {
      continue;
    }
    const status = (inv.status || "draft") as OverageInvoiceStatus;
    if (status === "void") {
      continue;
    }
    result.set(row.invoiceId, {
      invoiceId: inv.id,
      period: row.period,
      status,
      link: stripeLink("invoices", inv.id),
      total: (inv.total || 0) / 100,
    });
  }
  return result;
}

export type CreateOverageInvoiceInput = {
  workspaceId: string;
  workspaceName: string;
  stripeCustomerId: string;
  /** Billing period start, inclusive (ISO). */
  periodStartIso: string;
  /** Billing period end, exclusive (ISO). */
  periodEndIso: string;
  /** Overage events beyond the included quota. */
  eventsOver: number;
  /** Event overage fee, dollars (discount already applied). */
  eventsFee: number;
  /** Active syncs over the included limit. */
  syncsOver: number;
  /** Sync overage fee, dollars (discount already applied). */
  syncsFee: number;
};

export type CreateOverageInvoiceResult = {
  invoiceId: string;
  period: string;
  link: string;
  total: number;
  /** True when an existing invoice was returned instead of creating a new one. */
  reused: boolean;
};

/** Build a "reused" result for an already-stored invoice; null if it is gone or voided in Stripe. */
async function reuseStoredInvoice(row: OverageInvoiceRow): Promise<CreateOverageInvoiceResult | null> {
  const info = (await fetchOverageInvoiceInfos([row])).get(row.invoiceId);
  return info
    ? { invoiceId: info.invoiceId, period: row.period, link: info.link, total: info.total, reused: true }
    : null;
}

/**
 * Create a draft Stripe overage invoice for a workspace's completed billing
 * period and record it in `overage_invoices`.
 *
 * Idempotent and concurrency-safe:
 *  - A non-voided invoice already stored for the exact period is returned as-is.
 *  - The `(workspaceId, period)` primary key is the atomic guard. The row is
 *    written with a plain `create`, so two concurrent requests cannot both
 *    persist: the loser hits `P2002`, deletes its now-duplicate draft and
 *    returns the winner's invoice.
 *  - Any other persistence failure also deletes the draft, so a failed run
 *    never leaves an orphan invoice that a retry would then duplicate.
 *
 * The invoice is left as a draft (`auto_advance: false`) — an admin reviews it
 * in Stripe and finalizes it there, which is what charges the customer.
 */
export async function createOverageInvoice(input: CreateOverageInvoiceInput): Promise<CreateOverageInvoiceResult> {
  const period = periodKey(input.periodStartIso, input.periodEndIso);
  const key = { workspaceId_period: { workspaceId: input.workspaceId, period } };
  const rowSelect = { workspaceId: true, period: true, invoiceId: true } as const;

  // Fast path — reuse a non-voided invoice already stored for this exact period.
  const existing = await prisma.overageInvoice.findUnique({ where: key, select: rowSelect });
  if (existing) {
    const reused = await reuseStoredInvoice(existing);
    if (reused) {
      return reused;
    }
    // Stored invoice was deleted/voided in Stripe — drop the stale row, recreate.
    await prisma.overageInvoice.delete({ where: key }).catch(() => undefined);
  }

  if (input.eventsOver <= 0 && input.syncsOver <= 0) {
    throw new Error(`Workspace ${input.workspaceId} has no overage for period ${period}`);
  }

  const linePeriod = {
    start: Math.floor(dayjs.utc(input.periodStartIso).valueOf() / 1000),
    end: Math.floor(dayjs.utc(input.periodEndIso).valueOf() / 1000),
  };

  // Draft invoice. `pending_invoice_items_behavior: "exclude"` keeps unrelated
  // pending invoice items off it; `auto_advance: false` leaves it for review.
  const invoice = await stripe.invoices.create({
    customer: input.stripeCustomerId,
    auto_advance: false,
    collection_method: "charge_automatically",
    pending_invoice_items_behavior: "exclude",
    description: `Usage overage — ${input.workspaceName} (${period})`,
    metadata: { jitsu_overage: "true", jitsu_workspace_id: input.workspaceId, jitsu_period: period },
  });

  try {
    if (input.eventsOver > 0 && input.eventsFee > 0) {
      // `quantity` must be an integer; the per-event price is then derived from
      // the final (discounted) fee so the invoice total equals the figure shown
      // in the admin table.
      const quantity = Math.round(input.eventsOver);
      const unitAmountDecimal = ((input.eventsFee * 100) / quantity).toFixed(12);
      await stripe.invoiceItems.create({
        customer: input.stripeCustomerId,
        invoice: invoice.id,
        currency: "usd",
        description: EVENTS_LINE_DESCRIPTION,
        quantity,
        unit_amount_decimal: unitAmountDecimal,
        period: linePeriod,
      });
    }
    if (input.syncsOver > 0 && input.syncsFee > 0) {
      await stripe.invoiceItems.create({
        customer: input.stripeCustomerId,
        invoice: invoice.id,
        currency: "usd",
        description: `Overage fee - active syncs over plan limit (${input.syncsOver})`,
        amount: Math.round(input.syncsFee * 100),
        period: linePeriod,
      });
    }
    // Persist. A plain `create` makes the (workspaceId, period) primary key the
    // atomic guard against concurrent duplicate creation — see the catch below.
    await prisma.overageInvoice.create({ data: { workspaceId: input.workspaceId, period, invoiceId: invoice.id } });
  } catch (e) {
    // Roll back our draft so a failed (or lost-the-race) run leaves nothing
    // behind for a retry to duplicate.
    await stripe.invoices.del(invoice.id).catch(() => undefined);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // A concurrent request persisted first — return its invoice, not ours.
      const winner = await prisma.overageInvoice.findUnique({ where: key, select: rowSelect });
      if (winner) {
        const reused = await reuseStoredInvoice(winner);
        if (reused) {
          return reused;
        }
      }
    }
    throw e;
  }
  log.atInfo().log(`Created overage invoice ${invoice.id} for workspace ${input.workspaceId}, period ${period}`);

  const finalized = await stripe.invoices.retrieve(invoice.id);
  return {
    invoiceId: invoice.id,
    period,
    link: stripeLink("invoices", invoice.id),
    total: (finalized.total || 0) / 100,
    reused: false,
  };
}

export type BackfillResult = {
  /** Invoices examined. */
  scanned: number;
  /** Invoices identified as overage invoices. */
  matched: number;
  /** Rows written to `overage_invoices`. */
  upserted: number;
  /** Overage invoices that could not be recorded, with the reason. */
  skipped: { invoiceId: string; reason: string }[];
};

/** Whether an invoice looks like a manually-created (or jitsu-created) overage invoice. */
function isOverageInvoice(invoice: Stripe.Invoice): boolean {
  if (invoice.metadata?.jitsu_overage === "true") {
    return true;
  }
  if (invoice.billing_reason !== "manual") {
    return false;
  }
  return invoice.lines.data.some(l => /overage/i.test(l.description || ""));
}

/** Period key for a backfilled invoice — from its metadata, else from the overage line's period. */
function backfillPeriod(invoice: Stripe.Invoice): string | null {
  if (invoice.metadata?.jitsu_period) {
    return invoice.metadata.jitsu_period;
  }
  const line = invoice.lines.data.find(l => /overage/i.test(l.description || "")) || invoice.lines.data[0];
  if (!line?.period?.start || !line?.period?.end) {
    return null;
  }
  return periodKey(dayjs.unix(line.period.start).utc().toISOString(), dayjs.unix(line.period.end).utc().toISOString());
}

/**
 * Scan Stripe invoices from the last `months` and record every overage invoice
 * in `overage_invoices`. Voided invoices are skipped. Existing rows are updated.
 */
export async function backfillOverageInvoices(months: number): Promise<BackfillResult> {
  const gte = Math.floor(dayjs().utc().subtract(months, "month").valueOf() / 1000);

  // Customer id -> workspace id, from the stripe-settings table.
  const stripeEntries = (await store.getTable(stripeDataTable).list()) as { id: string; obj: StripeDataTableEntry }[];
  const workspaceByCustomer = new Map<string, string>();
  for (const entry of stripeEntries) {
    if (entry.obj?.stripeCustomerId) {
      workspaceByCustomer.set(entry.obj.stripeCustomerId, entry.id);
    }
  }

  const result: BackfillResult = { scanned: 0, matched: 0, upserted: 0, skipped: [] };
  let startingAfter: string | undefined = undefined;
  do {
    const page = await stripe.invoices.list({ limit: 100, starting_after: startingAfter, created: { gte } });
    for (const invoice of page.data) {
      result.scanned++;
      if (invoice.status === "void") {
        continue;
      }
      if (!isOverageInvoice(invoice)) {
        continue;
      }
      result.matched++;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const workspaceId = customerId ? workspaceByCustomer.get(customerId) : undefined;
      if (!workspaceId) {
        result.skipped.push({ invoiceId: invoice.id, reason: `no workspace for customer ${customerId}` });
        continue;
      }
      const period = backfillPeriod(invoice);
      if (!period) {
        result.skipped.push({ invoiceId: invoice.id, reason: "no billing period on invoice lines" });
        continue;
      }
      await prisma.overageInvoice.upsert({
        where: { workspaceId_period: { workspaceId, period } },
        create: { workspaceId, period, invoiceId: invoice.id },
        update: { invoiceId: invoice.id },
      });
      result.upserted++;
    }
    startingAfter = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
  } while (startingAfter);

  log
    .atInfo()
    .log(`Overage backfill: scanned ${result.scanned}, matched ${result.matched}, upserted ${result.upserted}`);
  return result;
}
