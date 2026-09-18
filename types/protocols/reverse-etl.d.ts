import type { ZodType } from "zod";
import type { FetchOpts, FetchType, FunctionLogger } from "./functions";

export type RecordKey = string;
export type OperationId = string;
export type BuiltinReverseDestinationName = `builtin.reverse.${string}`;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type SourceCursor = { value: string; primaryKeyValues: string[] };

export interface ReverseEtlRecord<Row> {
  key: RecordKey;
  sourceSequence: number;
  row: Row;
}
export interface WriteBatch<Row> {
  batchId: string;
  records: Array<ReverseEtlRecord<Row> & { operationId: OperationId }>;
}
export type RecordOutcome =
  | { operationId: OperationId; status: "accepted" }
  | { operationId: OperationId; status: "staged" }
  | { operationId: OperationId; status: "rejected"; code: string; safeReason: string };
export interface BatchResult {
  outcomes: RecordOutcome[];
  remoteJobIds?: string[];
  providerCheckpoint?: JsonObject;
}
export interface FinishResult {
  delivery: "accepted" | "pending";
  remoteJobIds?: string[];
  providerCheckpoint?: JsonObject;
}
export interface ReverseEtlCapabilities {
  supportsUpsert: boolean;
  supportsExplicitRemove: boolean;
  mirror: "none" | "snapshot-diff" | "native-replace";
  replay: "idempotency-key" | "idempotent-operation" | "reconcile-required";
}

/** Browser-safe metadata. Provider implementations/SDKs must not be imported here. */
export interface ReverseEtlStreamMetadata<Row, Options> {
  name: string;
  displayName: string;
  rowType: ZodType<Row>;
  removeRowType?: ZodType<Row>;
  options: ZodType<Options>;
  batchSize: number;
  /** Batches resolve independently; finish must not turn staging into acceptance. */
  batchDelivery?: "asynchronous";
  capabilities: ReverseEtlCapabilities;
}
export interface BufferedSyncStore {
  get(key: string): Json | undefined;
  set(key: string, value: Json): void;
  delete(key: string): void;
  /** A bounded copy, committed atomically with receipts/checkpoints by the persistence module. */
  snapshot(): JsonObject;
}
/** Bound to one immutable target/revision/logical run; execution ownership is external. */
export interface ReverseEtlRunScope {
  syncId: string;
  taskId: string;
  logicalRunId: string;
  configRevision: string;
  targetIdentity: string;
}
export interface PreparedBatch<Row> extends WriteBatch<Row> {
  action: "upsert" | "remove";
  payloadHash: string;
  cursor?: SourceCursor;
}
export interface ResumePoint {
  sourceSequence: number;
  cursor?: SourceCursor;
}

/**
 * Awaited persistence boundary; the Node runner owns durable storage (PostgreSQL
 * metadata plus immutable object-storage artifacts).
 * Provider implementations receive this interface, never a database client.
 * There is no production in-memory fallback or requirement for an RPC transport.
 * Bind scope on construction and validate lifecycle transitions. Persist bounded
 * replay payloads before returning from prepare. Acknowledge atomically publishes
 * receipts and their effective membership changes. Worker ownership belongs to Kubernetes
 * leases and syncctl; this interface has no billing or encryption responsibilities.
 */
export interface DeliveryJournal {
  /**
   * Refuse unresolved prepared/pending work before new extraction or init.
   * Without a cursor, the runner restarts extraction at sequence zero after this
   * gate, even for a completed run. Retain prior receipts; never skip by sequence.
   */
  assertReady(): Promise<ResumePoint>;
  /** Fence and journal init before writer construction or any audience/session creation. */
  prepareInit(store: JsonObject): Promise<void>;
  acknowledgeInit(store: JsonObject): Promise<void>;
  /** Fence and prepare cleanup before provider-mutating abort. Reject stale owners. */
  prepareAbort(): Promise<void>;
  /** Complete cleanup without deleting accepted receipts or unresolved remote IDs. */
  acknowledgeAbort(): Promise<void>;
  /** Independent jobs require distinct projected member identities within the extraction. */
  prepare<Row>(batch: PreparedBatch<Row>, store: JsonObject, independent?: boolean): Promise<void>;
  acknowledge(batchId: string, result: BatchResult, store: JsonObject): Promise<void>;
  /** Never replace already known accepted/rejected receipts with unknown. */
  markUnknown(batchId: string): Promise<void>;
  /** Persist session/job IDs created by init before relying on them. */
  saveProviderState(state: JsonObject): Promise<void>;
  /** Seal complete upsert extraction while independently processing batches are pending. */
  sealExtraction(throughSequence: number, store: JsonObject): Promise<void>;
  /** Persist a finish manifest before final submission, including empty runs. */
  prepareFinish(throughSequence: number, store: JsonObject): Promise<void>;
  /** Resolve this run's staged manifest in bounded transactions before returning accepted. */
  acknowledgeFinish(result: FinishResult, store: JsonObject): Promise<void>;
  /** Verify a contiguous accepted prefix; atomically write cursor + store + sequence. */
  commitCheckpoint(point: ResumePoint, store: JsonObject, complete: boolean): Promise<void>;
}
/** Snapshot storage, diff planning and generation promotion belong to the runner core. */
export interface ReverseEtlContext<Credentials, Options> extends ReverseEtlRunScope {
  mode: "upsert" | "mirror";
  fullRefresh: boolean;
  credentials: Credentials;
  options: Options;
  signal: AbortSignal;
  log: FunctionLogger;
  /** Runner-native fetch; provider credentials must never follow redirects. */
  fetch: (url: string, opts?: FetchOpts & { signal?: AbortSignal; redirect?: "error" }) => ReturnType<FetchType>;
  store: BufferedSyncStore;
  delivery: DeliveryJournal;
}
export interface ReverseEtlWriter<Row> {
  init(): Promise<void>;
  upsert(batch: WriteBatch<Row>): Promise<BatchResult>;
  remove?(batch: WriteBatch<Row>): Promise<BatchResult>;
  finish(): Promise<FinishResult>;
  /** Clean up unaccepted staging only; never undo accepted operations or erase recovery evidence. */
  abort(reason: "error" | "cancelled"): Promise<void>;
  reconcile?(remoteJobIds: string[]): Promise<FinishResult>;
}
export interface ReverseEtlStream<Credentials, Row, Options> extends ReverseEtlStreamMetadata<Row, Options> {
  /** Called inside the prepared init boundary; persist any created remote IDs for recovery. */
  createWriter(ctx: ReverseEtlContext<Credentials, Options>): Promise<ReverseEtlWriter<Row>>;
}
export interface ReverseEtlDestination<Credentials> {
  credentials: ZodType<Credentials>;
  streams: ReverseEtlStream<Credentials, any, any>[];
  defaultStream: string;
}
