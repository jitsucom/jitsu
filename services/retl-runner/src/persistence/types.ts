import type { Json, JsonObject, PreparedBatch, ReverseEtlRunScope } from "@jitsu/protocols/reverse-etl";

export interface RunInput extends ReverseEtlRunScope {
  workspaceId: string;
  mode: "upsert" | "mirror";
  /** Full includes cursorless models and explicit full refresh. */
  extraction: "cursor" | "full";
  /** Pending event keys cannot be copied as acknowledged delivery into a new run. */
  insertOnly?: boolean;
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
/** Pure delivery adapter; returns 1–100 identities. Removes must project to the same canonical identity as upserts. */
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
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistenceError";
  }
}
/** Fixed safe message: no database/provider payload is exposed in task errors. */
export class PersistenceResetRequiredError extends PersistenceError {
  constructor() {
    super("Legacy Reverse ETL state requires an explicit test-sync reset before enabling object storage");
  }
}
export function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new PersistenceError(message);
}
