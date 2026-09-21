import { canonicalJson, contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { effects } from "../persistence/effects";
import { ensure, type Identity } from "../persistence/types";
import type { ObjectJournal } from "./journal";
import type { SnapshotHead } from "./state";
import type { ArtifactRef } from "./store";

export class ObjectSnapshots {
  private pending?: SnapshotHead;
  constructor(private readonly journal: ObjectJournal) {}
  private get db() {
    return this.journal.db;
  }
  async start(refreshAfterMs?: number, strategy: "snapshot-diff" | "native-replace" = "snapshot-diff") {
    ensure(
      refreshAfterMs === undefined || (Number.isSafeInteger(refreshAfterMs) && refreshAfterMs > 0),
      "Invalid refresh interval"
    );
    const control = await this.journal.current();
    ensure(control.mode === "mirror" && ["new", "running"].includes(control.phase), "Cannot start snapshot");
    ensure(!this.journal.head.snapshot?.sealed, "Snapshot is sealed");
    if (this.pending) return;
    this.pending = {
      ...(strategy === "native-replace" ? { strategy } : {}),
      sealed: false,
      parts: [],
      keys: 0,
      entries: 0,
      bytes: 0,
      page: 0,
      pageHash: "",
      refreshBefore:
        this.journal.head.snapshot?.refreshBefore ??
        (refreshAfterMs ? new Date(Date.now() - refreshAfterMs).toISOString() : null),
    };
    await this.journal.publish({ ...this.journal.head, snapshot: this.pending });
  }
  async status() {
    const value = this.pending ?? this.journal.head.snapshot;
    return value ? { sealed: value.sealed, lastPageSequence: value.page, sourceKeyCount: value.keys } : undefined;
  }
  async append(rows: { key: string; identities: Identity[] }[], pageSequence: number) {
    rows = JSON.parse(canonicalJson(rows));
    ensure(["new", "running"].includes((await this.journal.current()).phase), "Cannot append snapshot in this phase");
    const snapshot = this.pending;
    ensure(snapshot && !snapshot.sealed, "Snapshot is absent or sealed");
    ensure(rows.length > 0 && rows.length <= this.db.limits.batchRecords, "Snapshot page exceeds entry limit");
    const projected = rows.map(row => ({ key: row.key, effects: effects(row.identities, { allowEmpty: true }) }));
    ensure(
      Buffer.byteLength(JSON.stringify(projected)) <= this.db.limits.batchBytes,
      "Snapshot page exceeds byte limit"
    );
    const hash = contentHash(projected);
    if (pageSequence === snapshot.page) {
      ensure(hash === snapshot.pageHash, "Snapshot page retry differs");
      return;
    }
    ensure(
      Number.isSafeInteger(pageSequence) && pageSequence === snapshot.page + 1,
      "Snapshot page sequence must be contiguous"
    );
    ensure(
      projected.every(row => /^[a-f0-9]{64}$/.test(row.key)),
      "Invalid source key"
    );
    const entries = snapshot.entries + projected.reduce((n, row) => n + Math.max(1, row.effects.length), 0);
    const bytes = snapshot.bytes + Buffer.byteLength(JSON.stringify(projected));
    ensure(
      entries <= this.db.limits.snapshotEntries && bytes <= this.db.limits.snapshotBytes,
      "Snapshot storage budget exceeded"
    );
    this.journal.local.append(projected);
    this.pending = {
      ...snapshot,
      entries,
      bytes,
      keys: snapshot.keys + rows.length,
      page: pageSequence,
      pageHash: hash,
    };
  }
  async seal(counts?: { projectedMembers: number; excludedRows: number }) {
    ensure((await this.journal.current()).phase === "running", "Cannot seal snapshot in this phase");
    const snapshot = this.pending;
    ensure(snapshot && !snapshot.sealed, "Snapshot is absent or sealed");
    const parts: ArtifactRef[] = [];
    let uniqueMembers = 0;
    for (const page of this.journal.local.desiredPages()) {
      parts.push(await this.journal.artifacts.put(page));
      uniqueMembers += page.length;
    }
    const sealed = {
      ...snapshot,
      parts,
      sealed: true,
      summary: { ...this.journal.local.comparison(snapshot.refreshBefore), ...counts },
    };
    await this.journal.publish({ ...this.journal.head, snapshot: sealed });
    this.pending = undefined;
    return { uniqueMembers };
  }
  async page(kind: "additions" | "removals", after = "", limit = 1000) {
    ensure(
      (after === "" || /^[a-f0-9]{64}$/.test(after)) && Number.isSafeInteger(limit) && limit > 0 && limit <= 1000,
      "Invalid diff page"
    );
    ensure(this.journal.head.snapshot?.sealed, "Full snapshot must be sealed");
    if (this.journal.head.snapshot.strategy === "native-replace") {
      ensure(kind === "additions", "Native replacement does not use individual removals");
      return this.journal.local.replacementPage(after, limit);
    }
    if (kind === "removals") await this.assertRemovalsAllowed();
    return this.journal.local.page(kind, after, limit, this.journal.head.snapshot.refreshBefore);
  }
  async assertRemovalsAllowed() {
    const snapshot = this.journal.head.snapshot;
    ensure(snapshot?.strategy !== "native-replace", "Native replacement does not use individual removals");
    ensure(snapshot?.sealed, "Full source must be sealed before removals");
    ensure(
      !this.journal.head.batches.some(
        batch => batch.action === "upsert" && batch.accepted !== batch.last - batch.first + 1
      ),
      "Unaccepted additions prohibit removals"
    );
    ensure(
      !this.journal.local.page("additions", "", 1, snapshot.refreshBefore).length,
      "Desired additions are not durably accepted"
    );
  }
  async assertPromotable() {
    if (this.journal.head.snapshot?.strategy === "native-replace") {
      await this.assertReplacementReady();
      ensure(this.journal.head.snapshot.replacementStatus === "accepted", "Replacement cleanup is not accepted");
      return;
    }
    await this.assertRemovalsAllowed();
    ensure(!this.journal.local.page("removals", "", 1, null).length, "Unremoved memberships prohibit promotion");
  }
  async assertReplacementReady() {
    const snapshot = this.journal.head.snapshot;
    ensure(snapshot?.sealed && snapshot.strategy === "native-replace", "Replacement requires a sealed snapshot");
    ensure(
      this.journal.head.batches.every(
        batch => batch.action === "upsert" && batch.accepted === batch.last - batch.first + 1
      ),
      "Unaccepted uploads prohibit replacement cleanup"
    );
    ensure(!this.journal.local.replacementPage("", 1).length, "Incomplete uploads prohibit replacement cleanup");
  }
}
