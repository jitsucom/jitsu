import type { Json, JsonObject, PreparedBatch, ReverseEtlRunScope } from "@jitsu/protocols/reverse-etl";

export interface RunInput extends ReverseEtlRunScope {
  workspaceId: string;
  mode: "upsert" | "mirror";
  /** Full includes cursorless models and explicit full refresh. */
  extraction: "cursor" | "full";
}
export type Scope = Readonly<RunInput>;

/** Core-only, provider-ready projection; no warehouse row or snapshot API in writer context. */
export interface Identity {
  identity: Json;
  upsert: JsonObject;
  remove: JsonObject;
}
export interface Effect extends Identity {
  identityHash: string;
  payloadHash: string;
}
/** Pure core adapter. Explicit removes must project to the same canonical identity as upserts. */
export type Project = (action: PreparedBatch<unknown>["action"], row: unknown) => Identity[];
export interface Limits {
  batchRecords: number;
  batchBytes: number;
  snapshotEntries: number;
  snapshotBytes: number;
  journalBytes: number;
}
export const defaultLimits: Limits = {
  batchRecords: 1000,
  batchBytes: 10_000_000,
  snapshotEntries: 1_000_000,
  snapshotBytes: 256_000_000,
  journalBytes: 256_000_000,
};
export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistenceError";
  }
}
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new PersistenceError(message);
}
