import type { BatchResult, PreparedBatch } from "@jitsu/protocols/reverse-etl";
import type { ArtifactRef } from "./store";
import type { Effect } from "../persistence/types";

/** Row-level evidence lives inside bounded artifacts, never in network database rows. */
export interface BatchData {
  batch: PreparedBatch<unknown>;
  effects: Effect[][];
}
export interface StoredBatchData {
  /** With `rows`, every record's `row` is null here: rows live in the retention bucket and expire with it. */
  batch: PreparedBatch<unknown>;
  // Mirror records already contain exact effect envelopes. Other modes keep
  // projection separately so neither artifact exceeds the per-object byte cap.
  effects: ArtifactRef | null;
  /** The batch's rows, stored in the retention bucket. Only replaying an unresolved batch needs them. */
  rows?: ArtifactRef;
}
export interface ReceiptData {
  result: BatchResult;
  acceptedAt: Record<string, string>;
}
export interface BatchHead {
  id: string;
  action: "upsert" | "remove";
  first: number;
  last: number;
  data: ArtifactRef;
  effectBytes: number;
  /** Size of the batch's rows artifact in the retention bucket; absent when the rows are inline in `data`. */
  rowBytes?: number;
  receipt?: ArtifactRef;
  status: "prepared" | "unknown" | "acknowledged" | "cancelled";
  accepted: number;
  staged: number;
  rejected: number;
  /** Confirmed by a remote receipt or accepted/staged outcomes; not merely prepared. */
  submittedRecords?: number;
  reservedEntries: number;
  reservedBytes: number;
  resultBudget: number;
}
export interface SnapshotHead {
  /** Absent in older snapshots: snapshot-diff. Strategy is fixed before any delivery. */
  strategy?: "native-replace";
  replacementStatus?: "prepared" | "pending" | "accepted";
  sealed: boolean;
  parts: ArtifactRef[];
  keys: number;
  entries: number;
  bytes: number;
  page: number;
  pageHash: string;
  refreshBefore: string | null;
  /** Immutable pre-delivery comparison. Optional for snapshots created by older runners. */
  summary?: {
    baselineMembers: number;
    uniqueMembers: number;
    newMembers: number;
    changedMembers: number;
    refreshMembers: number;
    /** Subset of refreshMembers; absent on snapshots created before this distinction was recorded. */
    unconfirmedRefreshMembers?: number;
    unchangedMembers: number;
    removals: number;
    projectedMembers?: number;
    excludedRows?: number;
  };
}
export interface ArtifactHead {
  version: 1;
  runId: string;
  baseline: ArtifactRef[];
  snapshot?: SnapshotHead;
  batches: BatchHead[];
}
