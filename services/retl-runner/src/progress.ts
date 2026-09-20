import type { ArtifactHead, BatchHead } from "./artifacts/state";

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
  private summarized = false;
  private readonly batches = new Map<
    string,
    Pick<BatchHead, "status" | "accepted" | "staged" | "rejected"> & { submitted: number; restored: boolean }
  >();
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

  /** Restored batches seed progress without presenting earlier submissions as new uploads. */
  async observe(head: ArtifactHead, restored = false) {
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
    for (const batch of head.batches) {
      const previous = this.batches.get(batch.id);
      const current = {
        status: batch.status,
        accepted: batch.accepted,
        staged: batch.staged,
        rejected: batch.rejected,
        submitted: batch.submittedRecords ?? batch.accepted + batch.staged,
        restored: restored || previous?.restored === true,
      };
      if (restored) {
        this.batches.set(batch.id, current);
        continue;
      }
      if (JSON.stringify(previous) === JSON.stringify(current)) continue;
      const records = batch.last - batch.first + 1;
      const action = batch.action === "upsert" ? "additions/upserts" : "removals";
      let message: string;
      if (batch.status === "prepared") message = `Preparing ${records} ${action}.`;
      else if (batch.status === "unknown")
        message = `Confirmation missing for ${records} ${action}; check destination status before retrying.`;
      else if (batch.status === "cancelled")
        message = `Cancelled ${records - batch.accepted - batch.rejected} ${action}; ${
          batch.accepted
        } previously accepted, ${batch.rejected} rejected in this batch.`;
      else {
        const submitted = current.submitted - (previous?.submitted ?? 0);
        message =
          (submitted > 0 && !current.restored
            ? `Submitted ${submitted} ${action}; `
            : `Status updated for ${records} ${action}: `) +
          `${batch.accepted} accepted, ${batch.staged} pending processing, ${batch.rejected} rejected in this batch.`;
      }
      if (await this.log(message)) this.batches.set(batch.id, current);
    }
  }

  /** One cumulative summary at the attempt boundary, including earlier attempts' delivery. */
  async summarize(head: ArtifactHead) {
    if (this.summarized) return;
    const snapshot = head.snapshot;
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
    this.summarized = await this.log(message);
  }
}
