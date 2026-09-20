import type { ArtifactHead } from "./artifacts/state";

export function deliveryTotals(head: ArtifactHead, action: "upsert" | "remove") {
  const totals = {
    batches: 0,
    submittedBatches: 0,
    records: 0,
    submitted: 0,
    accepted: 0,
    pending: 0,
    rejected: 0,
    unconfirmed: 0,
    cancelled: 0,
  };
  for (const batch of head.batches) {
    if (batch.action !== action) continue;
    const records = batch.last - batch.first + 1;
    const submitted = batch.submittedRecords ?? batch.accepted + batch.staged;
    totals.batches++;
    totals.records += records;
    totals.submitted += submitted;
    if (submitted) totals.submittedBatches++;
    totals.accepted += batch.accepted;
    totals.pending += batch.staged;
    totals.rejected += batch.rejected;
    if (batch.status === "prepared" || batch.status === "unknown") totals.unconfirmed += records;
    if (batch.status === "cancelled") totals.cancelled += records - batch.accepted - batch.rejected;
  }
  return totals;
}

/** Only aggregate core-owned counts. No payloads, identifiers, cursors or provider messages. */
export class RunProgress {
  private lastPlan = "";
  private lastDelivery = "";
  constructor(private readonly write: (message: string) => Promise<void>) {}

  async log(message: string) {
    try {
      await this.write(message);
      return true;
    } catch {
      // Observability failure must never change delivery/recovery decisions.
      process.stderr.write('{"event":"reverse_etl_progress_unavailable"}\n');
      return false;
    }
  }

  async observe(head: ArtifactHead) {
    const snapshot = head.snapshot;
    if (snapshot?.sealed) {
      const p = snapshot.summary;
      const plan = p
        ? `Mirror comparison (entire logical run): ${p.baselineMembers} previously acknowledged members; ${p.newMembers} new, ${p.changedMembers} changed, ${p.refreshMembers} unchanged due for expiry refresh, ${p.unchangedMembers} unchanged skipped, ${p.removals} to remove. Snapshot: ${snapshot.keys} source rows, ${p.uniqueMembers} unique members` +
          (p.projectedMembers === undefined
            ? "; original duplicate count unavailable"
            : `, ${p.projectedMembers} projected members, ${
                p.projectedMembers - p.uniqueMembers
              } duplicates collapsed, ${p.excludedRows ?? 0} source rows excluded by projection`) +
          "."
        : "Original mirror comparison counts are unavailable for this older run; saved delivery totals remain available.";
      if (plan !== this.lastPlan && (await this.log(plan))) this.lastPlan = plan;
    }
    if (!head.batches.length && !snapshot?.sealed) return;
    const additions = deliveryTotals(head, "upsert"),
      removals = deliveryTotals(head, "remove");
    const format = (value: typeof additions) =>
      `${value.submitted} confirmed submitted in ${value.submittedBatches} batches; ${value.accepted} accepted, ${value.pending} pending processing, ${value.rejected} rejected, ${value.unconfirmed} prepared/unconfirmed, ${value.cancelled} cancelled`;
    let message = `Delivery totals (entire logical run, including earlier attempts): additions/upserts: ${format(
      additions
    )}. Removals: ${format(removals)}.`;
    if (additions.unconfirmed || removals.unconfirmed)
      message += " Unconfirmed batches may have reached the destination; they are not safe to replay blindly.";
    if (head.batches.some(batch => batch.status === "acknowledged" && batch.submittedRecords === undefined))
      message +=
        " Older receipts may not retain the exact submitted count; confirmed submission totals are a lower bound.";
    const p = snapshot?.summary;
    if (p) {
      const plannedAdditions = p.newMembers + p.changedMembers + p.refreshMembers;
      const remainingAdditions = Math.max(0, plannedAdditions - additions.records);
      const remainingRemovals = Math.max(0, p.removals - removals.records);
      message += ` Not yet prepared: ${remainingAdditions} additions/updates/refreshes, ${remainingRemovals} removals.`;
      if (remainingRemovals && additions.accepted < plannedAdditions)
        message += " Removals are blocked until all additions/updates/refreshes are accepted.";
      if (!plannedAdditions && !p.removals) message += " No audience changes or expiry refreshes needed.";
    }
    if (message !== this.lastDelivery && (await this.log(message))) this.lastDelivery = message;
  }
}
