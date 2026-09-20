import { describe, expect, it, vi } from "vitest";
import type { ArtifactHead, BatchHead } from "./artifacts/state";
import { deliveryTotals, RunProgress } from "./progress";

const batch = (extra: Partial<BatchHead> = {}): BatchHead => ({
  id: "private-batch",
  action: "upsert",
  first: 1,
  last: 64,
  status: "acknowledged",
  data: { key: "private-key", sha256: "a".repeat(64), bytes: 1, compressedBytes: 1 },
  effectBytes: 0,
  accepted: 0,
  staged: 64,
  rejected: 0,
  reservedEntries: 0,
  reservedBytes: 0,
  resultBudget: 0,
  submittedRecords: 64,
  ...extra,
});
const head = (): ArtifactHead => ({
  version: 1,
  runId: "private-run",
  baseline: [],
  batches: [batch()],
  snapshot: {
    sealed: true,
    parts: [],
    keys: 4601,
    entries: 4601,
    bytes: 0,
    page: 1,
    pageHash: "",
    refreshBefore: null,
    summary: {
      baselineMembers: 4183,
      uniqueMembers: 4244,
      newMembers: 64,
      changedMembers: 0,
      refreshMembers: 0,
      unchangedMembers: 4180,
      removals: 3,
      projectedMembers: 4601,
      excludedRows: 0,
    },
  },
});

describe("redacted run progress", () => {
  it("reports the complete mirror plan and distinguishes submission from acceptance", async () => {
    const messages: string[] = [];
    const progress = new RunProgress(async m => {
      messages.push(m);
    });
    await progress.observe(head());
    const text = messages.join("\n");
    for (const expected of [
      "4183 previously acknowledged",
      "64 new",
      "4180 unchanged skipped",
      "3 to remove",
      "4601 source rows",
      "4244 unique members",
      "4601 projected members",
      "357 duplicates collapsed",
      "64 confirmed submitted in 1 batches",
      "0 accepted, 64 pending",
      "3 removals",
      "Removals are blocked",
    ])
      expect(text).toContain(expected);
    expect(text).not.toContain("private-");
    await progress.observe(head());
    expect(messages).toHaveLength(2);
  });
  it("reports resumed totals and only logs changes as acceptance and removals progress", async () => {
    const messages: string[] = [];
    const progress = new RunProgress(async m => {
      messages.push(m);
    });
    const h = head();
    await progress.observe(h);
    h.batches[0] = batch({ accepted: 64, staged: 0 });
    await progress.observe(h);
    expect(messages.at(-1)).toContain("64 accepted, 0 pending");
    expect(messages.at(-1)).not.toContain("Removals are blocked");
    h.batches.push(batch({ action: "remove", first: 65, last: 67, submittedRecords: 3, staged: 3 }));
    await progress.observe(h);
    expect(messages.at(-1)).toContain("Removals: 3 confirmed submitted in 1 batches; 0 accepted, 3 pending");
    expect(messages.filter(m => m.startsWith("Mirror comparison"))).toHaveLength(1);
    const resumed: string[] = [];
    await new RunProgress(async m => {
      resumed.push(m);
    }).observe(h);
    expect(resumed[0]).toContain("4183 previously acknowledged");
    expect(resumed[1]).toContain("including earlier attempts");
  });
  it("never labels prepared or unknown records as confirmed submitted", () => {
    const h = head();
    h.batches = [
      batch({ status: "unknown", submittedRecords: undefined, staged: 0 }),
      batch({ status: "prepared", submittedRecords: undefined, staged: 0 }),
    ];
    expect(deliveryTotals(h, "upsert")).toMatchObject({ submitted: 0, accepted: 0, unconfirmed: 128 });
  });
  it("distinguishes rejection before submission, provider rejection and cancellation", () => {
    const h = head();
    h.batches = [batch({ submittedRecords: 0, rejected: 64, staged: 0 })];
    expect(deliveryTotals(h, "upsert")).toMatchObject({ submitted: 0, rejected: 64 });
    h.batches[0].submittedRecords = 64;
    expect(deliveryTotals(h, "upsert").submitted).toBe(64);
    h.batches = [batch({ status: "cancelled", staged: 0, accepted: 10 })];
    expect(deliveryTotals(h, "upsert")).toMatchObject({ submitted: 64, accepted: 10, cancelled: 54, pending: 0 });
  });
  it("handles older artifacts without inventing a plan and tolerates log outages", async () => {
    const h = head();
    delete h.snapshot!.summary;
    delete h.batches[0].submittedRecords;
    const write = vi.fn().mockRejectedValueOnce(new Error("private-token")).mockResolvedValue(undefined);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const progress = new RunProgress(write);
      await expect(progress.observe(h)).resolves.toBeUndefined();
      expect(stderr).toHaveBeenCalledWith('{"event":"reverse_etl_progress_unavailable"}\n');
      await progress.observe(h);
      expect(write.mock.calls.flat().join(" ")).toContain("counts are unavailable for this older run");
      expect(write.mock.calls.flat().join(" ")).toContain("64 confirmed submitted");
      expect(write.mock.calls.flat().join(" ")).toContain("confirmed submission totals are a lower bound");
    } finally {
      stderr.mockRestore();
    }
  });
});
