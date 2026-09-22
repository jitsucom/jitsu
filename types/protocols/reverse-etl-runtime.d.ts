import type { ZodType } from "zod";
import type {
  BatchResult,
  FinishResult,
  Json,
  JsonObject,
  ReverseEtlContext,
  ReverseEtlStream,
  ReverseEtlWriter,
  WriteBatch,
} from "./reverse-etl";
export interface ReverseIdentity {
  identity: Json;
  upsert: JsonObject;
  remove: JsonObject;
}
export type ReverseProjection = (action: "upsert" | "remove", row: unknown) => ReverseIdentity[];
export interface ReverseRuntimeRecovery<C = JsonObject, O = JsonObject> {
  attachWriter(context: ReverseEtlContext<C, O>): Promise<ReverseEtlWriter<JsonObject>>;
  reconcileBatch?(
    batch: WriteBatch<JsonObject>,
    action: "upsert" | "remove",
    saved: BatchResult | undefined,
    context: ReverseEtlContext<C, O>
  ): Promise<BatchResult>;
  reconcileFinish?(saved: FinishResult | undefined, context: ReverseEtlContext<C, O>): Promise<FinishResult>;
  reconcileInit?(context: ReverseEtlContext<C, O>): Promise<"absent" | "cleaned-up">;
  reconcileAbort?(context: ReverseEtlContext<C, O>): Promise<void>;
}
export interface ReverseRuntimeAdapter {
  insertOnly?: boolean;
  options?: JsonObject;
  stream: ReverseEtlStream<JsonObject, JsonObject, JsonObject>;
  credentials: JsonObject;
  targetIdentity: string;
  project: ReverseProjection;
  mirror?: {
    stream: ReverseEtlStream<JsonObject, JsonObject, JsonObject>;
    projection: { rowType: ZodType<JsonObject>; project(row: JsonObject): ReverseIdentity[] };
    batchDelivery: "accepted" | "asynchronous";
    refreshAfterMs?: number;
  };
  verifyMirrorBaseline?(signal: AbortSignal): Promise<"new-empty" | "tracked" | "replace">;
  recovery?(providerState: JsonObject): ReverseRuntimeRecovery;
}
export interface ReverseDestinationConfig {
  id: string;
  workspaceId: string;
  toId: string;
  destination: Record<string, unknown>;
  model: { cursor?: unknown; deleteColumn?: unknown };
  options: { stream: string; mode: "upsert" | "mirror"; streamOptions: Record<string, any> };
}
/** Host-bound sync scope, not a provider-accessible database. Expected values are opaque JSON snapshots. */
export interface ScopedTargetState {
  read(): Promise<unknown | undefined>;
  /** Creating initial state must atomically reject an existing delivery baseline. */
  create(value: JsonObject): Promise<void>;
  compareAndSet(expected: JsonObject, value: JsonObject): Promise<boolean>;
}
export interface DestinationServices {
  targetState?(key: string): ScopedTargetState;
  getAccessToken(signal: AbortSignal): Promise<string>;
  fetch: typeof fetch;
  signal: AbortSignal;
  log(message: string): Promise<unknown>;
  /** Deployment-owned defaults; never read process.env inside a provider adapter. */
  developerToken?: string;
}
