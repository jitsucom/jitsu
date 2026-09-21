import { describe, expect, it, vi } from "vitest";
import type { ArtifactHead, BatchHead } from "./artifacts/state";
import { batchStatistics, deliveryTotals, RunProgress } from "./progress";

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
  it("counts each batch once per action, with pending and mixed outcomes distinct", () => {
    const h = head();
    h.batches = [
      batch({ status: "prepared", staged: 0 }),
      batch({ status: "unknown", staged: 0 }),
      batch({ accepted: 10, staged: 50, rejected: 4 }),
      batch({ accepted: 64, staged: 0 }),
      batch({ rejected: 64, staged: 0 }),
      batch({ accepted: 60, rejected: 4, staged: 0 }),
      batch({ status: "cancelled", accepted: 10, staged: 0 }),
      batch({ action: "remove", accepted: 64, staged: 0 }),
    ];
    const stats = batchStatistics(h);
    expect(stats.upsert).toEqual({
      total: 7,
      prepared: 1,
      unconfirmed: 1,
      pending: 1,
      accepted: 1,
      rejected: 1,
      partial: 1,
      cancelled: 1,
    });
    expect(stats.remove).toMatchObject({ total: 1, accepted: 1, partial: 0, pending: 0 });
    expect(stats.records).toEqual({ accepted: 208, pending: 50, rejected: 72 });
    expect(stats.recordCounts).toEqual({
      upsert: { total: 448, prepared: 64, unconfirmed: 64, pending: 50, accepted: 144, rejected: 72, cancelled: 54 },
      remove: { total: 64, prepared: 0, unconfirmed: 0, pending: 0, accepted: 64, rejected: 0, cancelled: 0 },
    });
    for (const { total, ...outcomes } of Object.values(stats.recordCounts!)) {
      expect(Object.values(outcomes).reduce((sum, value) => sum + value, 0)).toBe(total);
    }
    expect(stats.replacement).toBeUndefined();
    expect(JSON.stringify(stats)).not.toMatch(/private-batch|private-key|sha256|submittedRecords/);
    h.snapshot!.strategy = "native-replace";
    h.snapshot!.replacementStatus = "pending";
    expect(batchStatistics(h)).toMatchObject({ replacement: "pending", remove: { total: 1 } });
  });
  it("persists aggregates on restore and change, retries outages, and never fails delivery", async () => {
    const stats = vi.fn().mockRejectedValueOnce(new Error("private-token")).mockResolvedValue(undefined);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const progress = new RunProgress(async () => {}, stats);
      const h = head();
      await expect(progress.observe(h, true)).resolves.toBeUndefined();
      await progress.observe(h);
      await progress.summarize(h);
      expect(stats).toHaveBeenCalledTimes(2);
      h.batches[0] = batch({ accepted: 64, staged: 0 });
      await progress.observe(h);
      expect(stats).toHaveBeenCalledTimes(3);
      expect(stats.mock.calls[2][0]).toMatchObject({
        upsert: { accepted: 1, pending: 0 },
        recordCounts: { upsert: { total: 64, accepted: 64, pending: 0 } },
      });
      expect(stderr.mock.calls.flat().join(" ")).not.toContain("private-token");
    } finally {
      stderr.mockRestore();
    }
  });
  it.each([undefined, "prepared", "pending", "accepted"] as const)(
    "reports native cleanup %s without inventing removals or replaying stages on restore",
    async status => {
      const messages: string[] = [];
      const progress = new RunProgress(async m => {
        messages.push(m);
      });
      const h = head();
      h.snapshot!.strategy = "native-replace";
      h.snapshot!.replacementStatus = status;
      await progress.observe(h, true);
      await progress.observe(h);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("All 4244 members will be uploaded");
      expect(messages[0]).toContain("357 duplicates collapsed");
      expect(messages[0]).not.toContain("unchanged skipped");
      await progress.summarize(h);
      await progress.summarize(h);
      expect(messages).toHaveLength(2);
      expect(messages[1]).toContain("full-snapshot uploads: 64 confirmed submitted");
      expect(messages[1]).toContain(
        `Full-audience cleanup: ${status === "prepared" ? "prepared/unconfirmed" : status ?? "not started"}`
      );
      expect(messages[1]).toContain("removed-member count is not provided by Google");
      expect(messages[1]).not.toContain("Removals: 0");
      expect(messages[1]).toContain("4180 snapshot members");
      expect(messages[1].includes("may have reached Google")).toBe(status === "prepared");
    }
  );
  it("reports the complete mirror plan and distinguishes submission from acceptance", async () => {
    const messages: string[] = [];
    const progress = new RunProgress(async m => {
      messages.push(m);
    });
    await progress.observe(head(), true);
    expect(messages.some(m => m.startsWith("Delivery totals"))).toBe(false);
    await progress.summarize(head());
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
    await progress.summarize(head());
    expect(messages).toHaveLength(2);
  });
  it("logs short stages and one final total as acceptance and removals progress", async () => {
    const messages: string[] = [];
    const progress = new RunProgress(async m => {
      messages.push(m);
    });
    const h = head();
    await progress.observe(h, true);
    h.batches[0] = batch({ accepted: 64, staged: 0 });
    await progress.observe(h);
    expect(messages.at(-1)).toBe(
      "Status updated for 64 additions/upserts: 64 accepted, 0 pending processing, 0 rejected in this batch."
    );
    h.batches.push(
      batch({
        id: "private-removal",
        action: "remove",
        first: 65,
        last: 67,
        status: "prepared",
        submittedRecords: undefined,
        staged: 0,
      })
    );
    await progress.observe(h);
    expect(messages.at(-1)).toBe("Preparing 3 removals.");
    expect(messages.join("\n")).not.toMatch(/may have reached|Confirmation missing/);
    h.batches[1] = { ...h.batches[1], status: "acknowledged", submittedRecords: 3, staged: 3 };
    await progress.observe(h);
    expect(messages.at(-1)).toBe("Submitted 3 removals; 0 accepted, 3 pending processing, 0 rejected in this batch.");
    const beforeRepeat = messages.length;
    await progress.observe(h);
    expect(messages).toHaveLength(beforeRepeat);
    expect(messages.some(m => m.startsWith("Delivery totals"))).toBe(false);
    await progress.summarize(h);
    await progress.summarize(h);
    expect(messages.at(-1)).toContain("Removals: 3 confirmed submitted in 1 batches; 0 accepted, 3 pending");
    expect(messages.at(-1)).not.toContain("Removals are blocked");
    expect(messages.filter(m => m.startsWith("Delivery totals"))).toHaveLength(1);
    expect(messages.filter(m => m.startsWith("Mirror comparison"))).toHaveLength(1);
    const resumed: string[] = [];
    const nextAttempt = new RunProgress(async m => {
      resumed.push(m);
    });
    await nextAttempt.observe(h, true);
    await nextAttempt.observe(h);
    expect(resumed).toHaveLength(1);
    await nextAttempt.summarize(h);
    expect(resumed[0]).toContain("4183 previously acknowledged");
    expect(resumed[1]).toContain("including earlier attempts");
  });
  it.each(["prepared", "unknown"] as const)(
    "warns about unresolved %s delivery at the end of an attempt",
    async status => {
      const messages: string[] = [];
      const progress = new RunProgress(async m => {
        messages.push(m);
      });
      const h = head();
      h.batches = [batch({ status: "prepared", submittedRecords: undefined, staged: 0 })];
      await progress.observe(h);
      expect(messages.at(-1)).toBe("Preparing 64 additions/upserts.");
      if (status === "unknown") {
        h.batches[0].status = "unknown";
        await progress.observe(h);
        expect(messages.at(-1)).toContain("Confirmation missing for 64 additions/upserts");
      }
      await progress.summarize(h);
      expect(messages.at(-1)).toContain("64 prepared/unconfirmed");
      expect(messages.at(-1)).toContain("may have reached the destination");
      expect(messages.filter(m => m.startsWith("Delivery totals"))).toHaveLength(1);
    }
  );
  it("summarizes an empty extraction once", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const progress = new RunProgress(write);
    const h = { ...head(), snapshot: undefined, batches: [] };
    await progress.observe(h, true);
    expect(write).not.toHaveBeenCalled();
    await progress.summarize(h);
    await progress.summarize(h);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain("0 confirmed submitted");
  });
  it("does not label reconciliation of a restored unknown batch as a new submission", async () => {
    const messages: string[] = [];
    const progress = new RunProgress(async m => {
      messages.push(m);
    });
    const h = head();
    h.batches = [batch({ status: "unknown", submittedRecords: undefined, staged: 0 })];
    await progress.observe(h, true);
    h.batches[0] = batch({ accepted: 64, staged: 0 });
    await progress.observe(h);
    expect(messages.at(-1)).toContain("Status updated for 64 additions/upserts: 64 accepted");
    expect(messages.join("\n")).not.toContain("Submitted 64");
    await progress.summarize(h);
    expect(messages.at(-1)).toContain("64 confirmed submitted");
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
      await expect(progress.observe(h, true)).resolves.toBeUndefined();
      expect(stderr).toHaveBeenCalledWith('{"event":"reverse_etl_progress_unavailable"}\n');
      await progress.observe(h);
      await progress.summarize(h);
      expect(write.mock.calls.flat().join(" ")).toContain("counts are unavailable for this older run");
      expect(write.mock.calls.flat().join(" ")).toContain("64 confirmed submitted");
      expect(write.mock.calls.flat().join(" ")).toContain("confirmed submission totals are a lower bound");
    } finally {
      stderr.mockRestore();
    }
  });
  it("retries a failed summary write without duplicating a successful one", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("private-token")).mockResolvedValue(undefined);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const progress = new RunProgress(write);
      await expect(progress.summarize(head())).resolves.toBeUndefined();
      await progress.summarize(head());
      await progress.summarize(head());
      expect(write).toHaveBeenCalledTimes(2);
      expect(stderr.mock.calls.flat().join(" ")).not.toContain("private-token");
    } finally {
      stderr.mockRestore();
    }
  });
});
