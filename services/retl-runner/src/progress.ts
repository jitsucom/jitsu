import type { ArtifactHead, BatchHead } from "./artifacts/state";
import type { ReverseBatchCounts, ReverseDeliveryStats, ReverseRecordCounts } from "@jitsu/protocols/reverse-etl-stats";

export function batchStatistics(head: ArtifactHead): ReverseDeliveryStats {
  const empty = (): ReverseBatchCounts => ({
    total: 0,
    prepared: 0,
    unconfirmed: 0,
    pending: 0,
    accepted: 0,
    rejected: 0,
    partial: 0,
    cancelled: 0,
  });
  const emptyRecords = (): ReverseRecordCounts => ({
    total: 0,
    prepared: 0,
    unconfirmed: 0,
    pending: 0,
    accepted: 0,
    rejected: 0,
    cancelled: 0,
  });
  const recordCounts = { upsert: emptyRecords(), remove: emptyRecords() };
  const stats: ReverseDeliveryStats = {
    version: 1,
    runId: head.runId,
    observedAt: new Date().toISOString(),
    upsert: empty(),
    remove: empty(),
    records: { accepted: 0, pending: 0, rejected: 0 },
    recordCounts,
    ...(head.snapshot?.strategy === "native-replace"
      ? { replacement: head.snapshot.replacementStatus ?? "not_started" }
      : {}),
  };
  for (const batch of head.batches) {
    const counts = stats[batch.action];
    const size = batch.last - batch.first + 1;
    const status =
      batch.status === "prepared"
        ? "prepared"
        : batch.status === "unknown"
        ? "unconfirmed"
        : batch.status === "cancelled"
        ? "cancelled"
        : batch.staged > 0
        ? "pending"
        : batch.accepted === size
        ? "accepted"
        : batch.rejected === size
        ? "rejected"
        : "partial";
    counts.total++;
    counts[status]++;
    const records = recordCounts[batch.action];
    records.total += size;
    records.accepted += batch.accepted;
    records.rejected += batch.rejected;
    // Keep known outcomes even when the rest of a batch is cancelled or unconfirmed.
    const remaining = size - batch.accepted - batch.rejected;
    if (batch.status === "prepared") records.prepared += remaining;
    else if (batch.status === "unknown") records.unconfirmed += remaining;
    else if (batch.status === "cancelled") records.cancelled += remaining;
    else records.pending += batch.staged;
    stats.records.accepted += batch.accepted;
    stats.records.pending += batch.staged;
    stats.records.rejected += batch.rejected;
  }
  return stats;
}

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
  /** Changes to delivery evidence, not log messages or refreshed observation timestamps. */
  deliveryChanged = false;
  private deliveryBaseline?: string;
  private lastStats = "";
  private lastPlan = "";
  private summarized = false;
  private lastReplacementStatus?: string;
  private readonly batches = new Map<
    string,
    Pick<BatchHead, "status" | "accepted" | "staged" | "rejected"> & { submitted: number; restored: boolean }
  >();
  constructor(
    private readonly write: (message: string) => Promise<void>,
    private readonly writeStats?: (stats: ReverseDeliveryStats) => Promise<void>
  ) {}

  private async statistics(head: ArtifactHead) {
    if (!this.writeStats) return;
    const stats = batchStatistics(head);
    const { observedAt, ...value } = stats;
    const key = JSON.stringify(value);
    if (key === this.lastStats) return;
    try {
      await this.writeStats(stats);
      this.lastStats = key;
    } catch {
      process.stderr.write('{"event":"reverse_etl_statistics_unavailable"}\n');
    }
  }

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
    const { observedAt, ...delivery } = batchStatistics(head);
    const fingerprint = JSON.stringify(delivery);
    if (!restored && this.deliveryBaseline !== undefined && fingerprint !== this.deliveryBaseline)
      this.deliveryChanged = true;
    this.deliveryBaseline = fingerprint;
    await this.statistics(head);
    const snapshot = head.snapshot;
    if (snapshot?.sealed) {
      const p = snapshot.summary;
      const plan =
        p && snapshot.strategy === "native-replace"
          ? `Full audience replacement: ${snapshot.keys} source rows, ${p.uniqueMembers} unique members${
              p.projectedMembers === undefined
                ? ""
                : `, ${p.projectedMembers} projected members, ${
                    p.projectedMembers - p.uniqueMembers
                  } duplicates collapsed, ${p.excludedRows ?? 0} source rows excluded by projection`
            }. All ${
              p.uniqueMembers
            } members will be uploaded, including unchanged members. Older audience membership is cleaned up only after every upload is accepted.`
          : p
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
    const replacementStatus = snapshot?.replacementStatus;
    if (restored) this.lastReplacementStatus = replacementStatus;
    else if (replacementStatus && replacementStatus !== this.lastReplacementStatus) {
      const message = {
        prepared: "Submitting full-audience cleanup; all snapshot uploads are accepted.",
        pending: "Google is processing full-audience cleanup; the next status check will poll the saved request.",
        accepted: "Full-audience cleanup accepted. Google does not report the number of members removed.",
      }[replacementStatus];
      if (await this.log(message)) this.lastReplacementStatus = replacementStatus;
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
    await this.statistics(head);
    if (this.summarized) return;
    const snapshot = head.snapshot;
    const replacement = snapshot?.strategy === "native-replace";
    const additions = deliveryTotals(head, "upsert"),
      removals = deliveryTotals(head, "remove");
    const format = (value: typeof additions) =>
      `${value.submitted} confirmed submitted in ${value.submittedBatches} batches; ${value.accepted} accepted, ${value.pending} pending processing, ${value.rejected} rejected, ${value.unconfirmed} prepared/unconfirmed, ${value.cancelled} cancelled`;
    let message = `Delivery totals (entire logical run, including earlier attempts): ${
      replacement ? "full-snapshot uploads" : "additions/upserts"
    }: ${format(additions)}.`;
    if (replacement) {
      const status = snapshot.replacementStatus;
      message += ` Full-audience cleanup: ${
        status === "prepared" ? "prepared/unconfirmed" : status ?? "not started"
      }; removed-member count is not provided by Google.`;
      if (status === "prepared")
        message += " Cleanup may have reached Google; do not replay without checking its outcome.";
      if (!status) message += " Cleanup waits for every snapshot upload to be accepted.";
    } else message += ` Removals: ${format(removals)}.`;
    if (additions.unconfirmed || removals.unconfirmed)
      message += " Unconfirmed batches may have reached the destination; they are not safe to replay blindly.";
    if (head.batches.some(batch => batch.status === "acknowledged" && batch.submittedRecords === undefined))
      message +=
        " Older receipts may not retain the exact submitted count; confirmed submission totals are a lower bound.";
    const p = snapshot?.summary;
    if (p && replacement) {
      message += ` Not yet prepared: ${Math.max(0, p.uniqueMembers - additions.records)} snapshot members.`;
    } else if (p) {
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
