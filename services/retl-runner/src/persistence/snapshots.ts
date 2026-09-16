import type { PoolClient } from "pg";
import { canonicalJson, contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { Database } from "./database";
import { readControl } from "./run-state";
import { decodeJson, encodeJson } from "./serialization";
import { ensure, type Effect, type Identity, type Scope } from "./types";
import type { DesiredRow, GenerationRow, MembershipRow } from "./rows";

export function effects(identities: Identity[]): Effect[] {
  ensure(
    Array.isArray(identities) && identities.length > 0 && identities.length <= 100,
    "Invalid identity projection size"
  );
  const result = identities.map(value => {
    ensure(value && value.identity !== null && value.upsert && value.remove, "Invalid identity projection");
    return { ...value, identityHash: contentHash(value.identity), payloadHash: contentHash(value.upsert) };
  });
  ensure(new Set(result.map(value => value.identityHash)).size === result.length, "Duplicate projected identity");
  return result;
}

/** Only the runner core owns this object. No method is exported in the writer context. */
export class Snapshots {
  constructor(readonly db: Database, readonly scope: Scope) {}
  private get key() {
    return [this.scope.workspaceId, this.scope.syncId, this.scope.logicalRunId];
  }
  async start() {
    await this.db.transaction(async client => {
      const control = await readControl(client, this.scope);
      ensure(
        control.mode === "mirror" && ["new", "running"].includes(control.phase),
        "Cannot start a snapshot in this phase"
      );
      const old = await client.query(
        "SELECT 1 FROM reverse_sync_generation WHERE workspace_id=$1 AND sync_id=$2 AND generation IS DISTINCT FROM $3 AND generation<>$4 LIMIT 1",
        [this.scope.workspaceId, this.scope.syncId, control.committed_generation, this.scope.logicalRunId]
      );
      ensure(!old.rowCount, "Prune abandoned/superseded snapshot generations before starting another");
      const current = await client.query<Pick<GenerationRow, "sealed">>(
        "SELECT sealed FROM reverse_sync_generation WHERE workspace_id=$1 AND sync_id=$2 AND generation=$3",
        this.key
      );
      if (current.rowCount) {
        ensure(!current.rows[0].sealed, "Snapshot is sealed");
        return;
      }
      await client.query(
        "INSERT INTO reverse_sync_generation (workspace_id,sync_id,generation) VALUES ($1,$2,$3)",
        this.key
      );
    });
  }
  /** Recovery can distinguish absent, partially extracted and sealed snapshots. */
  async status(): Promise<{ sealed: boolean; lastPageSequence: number; sourceKeyCount: number } | undefined> {
    return this.db.transaction(async client => {
      const control = await readControl(client, this.scope);
      ensure(control.mode === "mirror", "Snapshot status requires mirror mode");
      const result = await client.query<Pick<GenerationRow, "sealed" | "last_page_sequence" | "key_count">>(
        "SELECT sealed,last_page_sequence,key_count FROM reverse_sync_generation WHERE workspace_id=$1 AND sync_id=$2 AND generation=$3",
        this.key
      );
      const row = result.rows[0];
      return row
        ? {
            sealed: row.sealed,
            lastPageSequence: Number(row.last_page_sequence),
            sourceKeyCount: Number(row.key_count),
          }
        : undefined;
    });
  }
  /** Sequential source pages start at 1. Only an exact retry of the latest page is a no-op. */
  async append(rows: { key: string; identities: Identity[] }[], pageSequence: number) {
    ensure(Number.isSafeInteger(pageSequence) && pageSequence > 0, "Invalid snapshot page sequence");
    ensure(rows.length > 0 && rows.length <= this.db.limits.batchRecords, "Snapshot batch exceeds its entry budget");
    const serialized = canonicalJson(rows);
    ensure(Buffer.byteLength(serialized) <= this.db.limits.batchBytes, "Snapshot batch exceeds its byte budget");
    // Own the input before awaiting the transaction so the receipt and inserted values cannot diverge.
    const copied: typeof rows = JSON.parse(serialized);
    const projected = copied.map(row => ({ key: row.key, effects: effects(row.identities) }));
    const pageHash = contentHash(projected);
    await this.db.transaction(async client => {
      const control = await readControl(client, this.scope);
      ensure(
        control.mode === "mirror" && ["new", "running"].includes(control.phase),
        "Cannot append snapshot in this phase"
      );
      const generation = await client.query<GenerationRow>(
        "SELECT * FROM reverse_sync_generation WHERE workspace_id=$1 AND sync_id=$2 AND generation=$3",
        this.key
      );
      ensure(generation.rowCount && !generation.rows[0].sealed, "Snapshot is absent or sealed");
      const lastPageSequence = Number(generation.rows[0].last_page_sequence);
      if (pageSequence === lastPageSequence) {
        ensure(generation.rows[0].last_page_hash === pageHash, "Snapshot page retry differs from the saved page");
        return;
      }
      ensure(pageSequence === lastPageSequence + 1, "Snapshot page sequence must be contiguous");
      let entries = Number(generation.rows[0].entry_count);
      let bytes = Number(generation.rows[0].byte_count);
      for (const row of projected) {
        ensure(/^[a-f0-9]{64}$/.test(row.key), "Invalid source key");
        await client.query(
          "INSERT INTO reverse_sync_source_key (workspace_id,sync_id,generation,key_hash) VALUES ($1,$2,$3,$4)",
          [...this.key, row.key]
        );
        bytes += 64; // Stored source-key hash; no source-to-identity mapping is persisted.
        for (const effect of row.effects) {
          const value = encodeJson(effect, this.db.limits.batchBytes);
          const inserted = await client.query(
            `INSERT INTO reverse_sync_desired (workspace_id,sync_id,generation,identity_hash,payload_hash,value) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING 1`,
            [...this.key, effect.identityHash, effect.payloadHash, value]
          );
          if (!inserted.rowCount) {
            const existing = await client.query<Pick<DesiredRow, "payload_hash" | "value">>(
              "SELECT payload_hash,value FROM reverse_sync_desired WHERE workspace_id=$1 AND sync_id=$2 AND generation=$3 AND identity_hash=$4",
              [...this.key, effect.identityHash]
            );
            const previous = decodeJson<Effect>(existing.rows[0].value);
            ensure(canonicalJson(previous) === canonicalJson(effect), "Conflicting payloads for shared identity");
          } else bytes += value.length;
          // Bound projection work even when many source rows share one desired identity.
          entries++;
        }
      }
      ensure(
        entries <= this.db.limits.snapshotEntries && bytes <= this.db.limits.snapshotBytes,
        "Snapshot storage budget exceeded"
      );
      await client.query(
        "UPDATE reverse_sync_generation SET entry_count=$4,byte_count=$5,key_count=key_count+$6,last_page_sequence=$7,last_page_hash=$8 WHERE workspace_id=$1 AND sync_id=$2 AND generation=$3",
        [...this.key, entries, bytes, copied.length, pageSequence, pageHash]
      );
    });
  }
  async seal() {
    await this.db.transaction(async client => {
      const control = await readControl(client, this.scope);
      ensure(control.mode === "mirror" && control.phase === "running", "Cannot seal snapshot in this phase");
      const result = await client.query(
        "UPDATE reverse_sync_generation SET sealed=true WHERE workspace_id=$1 AND sync_id=$2 AND generation=$3 RETURNING 1",
        this.key
      );
      ensure(result.rowCount, "Snapshot is absent");
    });
  }
  /** Indexed keyset pages; the caller never loads a whole audience into memory. */
  async page(kind: "additions" | "removals", after = "", limit = 1000): Promise<Effect[]> {
    ensure(Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000, "Invalid diff page size");
    ensure(after === "" || /^[a-f0-9]{64}$/.test(after), "Invalid diff cursor");
    return this.db.transaction(async client => {
      const control = await readControl(client, this.scope);
      ensure(control.mode === "mirror" && control.phase === "running", "Cannot plan snapshot in this phase");
      if (kind === "removals") await this.assertRemovalsAllowed(client);
      const result =
        kind === "additions"
          ? await client.query<Pick<DesiredRow, "identity_hash" | "value">>(
              `SELECT d.identity_hash,d.value FROM reverse_sync_desired d LEFT JOIN reverse_sync_membership m
          ON m.workspace_id=d.workspace_id AND m.sync_id=d.sync_id AND m.identity_hash=d.identity_hash
          WHERE d.workspace_id=$1 AND d.sync_id=$2 AND d.generation=$3 AND d.identity_hash>$4
          AND (m.identity_hash IS NULL OR m.payload_hash<>d.payload_hash) ORDER BY d.identity_hash LIMIT $5`,
              [...this.key, after, limit]
            )
          : await client.query<Pick<MembershipRow, "identity_hash" | "value">>(
              `SELECT m.identity_hash,m.value FROM reverse_sync_membership m WHERE m.workspace_id=$1 AND m.sync_id=$2 AND m.identity_hash>$4
          AND NOT EXISTS (SELECT 1 FROM reverse_sync_desired d WHERE d.workspace_id=m.workspace_id AND d.sync_id=m.sync_id AND d.generation=$3 AND d.identity_hash=m.identity_hash)
          ORDER BY m.identity_hash LIMIT $5`,
              [...this.key, after, limit]
            );
      return result.rows.map(row => decodeJson<Effect>(row.value));
    });
  }
  async assertRemovalsAllowed(client: PoolClient) {
    const sealed = await client.query<Pick<GenerationRow, "sealed">>(
      "SELECT sealed FROM reverse_sync_generation WHERE workspace_id=$1 AND sync_id=$2 AND generation=$3",
      this.key
    );
    ensure(sealed.rows[0]?.sealed, "Full source must be sealed before removals");
    const pending = await client.query(
      `SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND action='upsert' AND status<>'accepted' LIMIT 1`,
      this.key
    );
    ensure(!pending.rowCount, "Unaccepted additions prohibit removals");
    const missing = await client.query(
      `SELECT 1 FROM reverse_sync_desired d LEFT JOIN reverse_sync_membership m
      ON m.workspace_id=d.workspace_id AND m.sync_id=d.sync_id AND m.identity_hash=d.identity_hash
      WHERE d.workspace_id=$1 AND d.sync_id=$2 AND d.generation=$3 AND (m.identity_hash IS NULL OR m.payload_hash<>d.payload_hash) LIMIT 1`,
      this.key
    );
    ensure(!missing.rowCount, "Desired additions are not durably accepted");
  }
  /** Called inside the journal's final-state transaction, never as a standalone promotion. */
  async assertPromotable(client: PoolClient) {
    await this.assertRemovalsAllowed(client);
    const extra = await client.query(
      `SELECT 1 FROM reverse_sync_membership m WHERE m.workspace_id=$1 AND m.sync_id=$2
      AND NOT EXISTS (SELECT 1 FROM reverse_sync_desired d WHERE d.workspace_id=m.workspace_id AND d.sync_id=m.sync_id AND d.generation=$3 AND d.identity_hash=m.identity_hash) LIMIT 1`,
      this.key
    );
    ensure(!extra.rowCount, "Unremoved effective memberships prohibit promotion");
  }
}
