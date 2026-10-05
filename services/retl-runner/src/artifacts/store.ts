import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { z } from "zod";
import { canonicalJson, contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { ensure, type Scope } from "../persistence/types";

/** Bucket/prefix/auth are deployment configuration, never part of an artifact reference. */
export interface ObjectStore {
  put(key: string, value: Buffer, signal: AbortSignal): Promise<void>;
  get(key: string, maxBytes: number, signal: AbortSignal): Promise<Buffer>;
}
export const ArtifactRef = z
  .object({
    key: z.string(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(16_000_000),
    compressedBytes: z.number().int().positive().max(16_000_000),
  })
  .strict();
export type ArtifactRef = z.infer<typeof ArtifactRef>;
/** Kinds that may be stored in the retention bucket. Only the rows of a batch are personal data; everything else stays put. */
export type ArtifactKind = "rows";
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Immutable, scoped, checksummed and bounded. No raw SDK errors cross this boundary. */
export class Artifacts {
  readonly prefix: string;
  /** Batch data written when a retention store is configured; read back by key prefix, so older refs are unaffected. */
  private readonly retentionPrefix: string;
  constructor(
    private readonly store: ObjectStore,
    scope: Scope,
    readonly signal: AbortSignal,
    private readonly retention?: ObjectStore
  ) {
    const scoped = contentHash([scope.workspaceId, scope.syncId, scope.configRevision, scope.targetIdentity]);
    this.prefix = `v1/${scoped}/`;
    this.retentionPrefix = `r1/${scoped}/`;
  }
  /** True when rows are kept apart, in the retention bucket, from the rest of a batch. */
  get retainsRows() {
    return this.retention !== undefined;
  }
  async put(value: unknown, kind?: ArtifactKind): Promise<ArtifactRef> {
    this.signal.throwIfAborted();
    const raw = Buffer.from(canonicalJson({ version: 1, value }));
    ensure(raw.length <= 16_000_000, "Artifact exceeds byte limit");
    const sha256 = digest(raw);
    const retained = kind === "rows" && this.retention !== undefined;
    const key = `${retained ? this.retentionPrefix : this.prefix}${sha256}.json.gz`;
    const compressed = gzipSync(raw);
    ensure(compressed.length <= 16_000_000, "Compressed artifact exceeds byte limit");
    try {
      await (retained ? this.retention! : this.store).put(
        key,
        compressed,
        AbortSignal.any([this.signal, AbortSignal.timeout(60_000)])
      );
    } catch {
      throw new Error(
        retained
          ? "Reverse ETL retention storage upload failed; no delivery is authorized"
          : "Reverse ETL artifact upload failed; no delivery is authorized"
      );
    }
    return { key, sha256, bytes: raw.length, compressedBytes: compressed.length };
  }
  async get<T>(input: unknown): Promise<T> {
    this.signal.throwIfAborted();
    const ref = ArtifactRef.parse(input);
    const retained = ref.key === `${this.retentionPrefix}${ref.sha256}.json.gz`;
    ensure(retained || ref.key === `${this.prefix}${ref.sha256}.json.gz`, "Artifact scope mismatch");
    ensure(!retained || this.retention, "Reverse ETL retention storage is unavailable; delivery blocked");
    try {
      const compressed = await (retained ? this.retention! : this.store).get(
        ref.key,
        ref.compressedBytes,
        AbortSignal.any([this.signal, AbortSignal.timeout(60_000)])
      );
      ensure(compressed.length === ref.compressedBytes, "Artifact length mismatch");
      const raw = gunzipSync(compressed, { maxOutputLength: ref.bytes });
      ensure(raw.length === ref.bytes && digest(raw) === ref.sha256, "Artifact checksum mismatch");
      const envelope = JSON.parse(raw.toString("utf8"));
      ensure(envelope.version === 1 && Object.hasOwn(envelope, "value"), "Invalid artifact envelope");
      return envelope.value;
    } catch {
      throw new Error("Reverse ETL recovery artifact is missing or corrupt; delivery blocked");
    }
  }
}
