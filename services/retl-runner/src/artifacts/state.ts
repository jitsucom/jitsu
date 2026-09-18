import type { BatchResult, PreparedBatch } from "@jitsu/protocols/reverse-etl";
import type { ArtifactRef } from "./store";
import type { Effect } from "../persistence/types";

/** Row-level evidence lives inside bounded artifacts, never in network database rows. */
export interface BatchData {
  batch: PreparedBatch<unknown>;
  effects: Effect[][];
}
export interface StoredBatchData {
  batch: PreparedBatch<unknown>;
  // Mirror records already contain exact effect envelopes. Other modes keep
  // projection separately so neither artifact exceeds the per-object byte cap.
  effects: ArtifactRef | null;
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
  receipt?: ArtifactRef;
  status: "prepared" | "unknown" | "acknowledged" | "cancelled";
  accepted: number;
  staged: number;
  rejected: number;
  reservedEntries: number;
  reservedBytes: number;
  resultBudget: number;
}
export interface SnapshotHead {
  sealed: boolean;
  parts: ArtifactRef[];
  keys: number;
  entries: number;
  bytes: number;
  page: number;
  pageHash: string;
  refreshBefore: string | null;
}
export interface ArtifactHead {
  version: 1;
  runId: string;
  baseline: ArtifactRef[];
  snapshot?: SnapshotHead;
  batches: BatchHead[];
}
