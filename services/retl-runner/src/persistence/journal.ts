import type { PoolClient } from "pg";
import type {
  BatchResult,
  DeliveryJournal,
  FinishResult,
  JsonObject,
  PreparedBatch,
  ResumePoint,
} from "@jitsu/protocols/reverse-etl";
import { canonicalJson, contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { validateBatchResult, validateFinishResult } from "@jitsu/destination-functions/src/reverse-etl/meta";
import { Database } from "./database";
import { decodeJson, encodeJson, jsonByteBudget } from "./serialization";
import { readSavedState, stateStream, type SavedState } from "./run-state";
import { controlFor, type ControlCache } from "./control-cache";
import { effects, Snapshots } from "./snapshots";
import { ensure, type Effect, type Project, type Scope } from "./types";
import type { BatchRow, ControlRow, OperationRow, StateRow } from "./rows";

interface SavedFinish {
  result: FinishResult;
  acceptance?: { at: string };
}
function readFinish(value: Buffer | null): SavedFinish {
  ensure(value, "Missing finish receipt");
  return decodeJson<SavedFinish>(value);
}

// Outcome array order is not significant; compare every outcome and metadata field.
function canonicalReceipt(result: BatchResult) {
  return canonicalJson({
    ...result,
    outcomes: Object.fromEntries(result.outcomes.map(outcome => [outcome.operationId, outcome])),
  });
}

export class Journal implements DeliveryJournal {
  readonly snapshots: Snapshots;
  private readonly control: ControlCache;
  constructor(
    readonly db: Database,
    readonly scope: Scope,
    private readonly project: Project,
    private readonly recovery: boolean
  ) {
    this.control = controlFor(db, scope);
    this.snapshots = new Snapshots(db, scope);
  }
  private get key() {
    return [this.scope.workspaceId, this.scope.syncId, this.scope.logicalRunId];
  }
  private async saveStore(client: PoolClient, store: JsonObject) {
    await client.query("UPDATE reverse_sync_control SET store=$3 WHERE workspace_id=$1 AND sync_id=$2", [
      ...this.key.slice(0, 2),
      encodeJson(store),
    ]);
  }
  async state(): Promise<{ store: JsonObject; providerState: JsonObject }> {
    return this.control.observe(control => ({
      store: control.store ? decodeJson<JsonObject>(control.store) : {},
      providerState: control.provider_state ? decodeJson<JsonObject>(control.provider_state) : {},
    }));
  }
  async assertReady(): Promise<ResumePoint> {
    return this.control.transaction(async client => {
      const control = await this.control.read(client);
      ensure(control.phase === "new", "Recover previous lifecycle before extraction");
      ensure(!this.recovery, "Reopen persistence after init recovery before extraction");
      const unresolved = await client.query(
        "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND status IN ('prepared','unknown','staged') LIMIT 1",
        this.key.slice(0, 2)
      );
      ensure(!unresolved.rowCount, "Unresolved operations require recovery");
      const saved = await client.query<Pick<StateRow, "state">>(
        `SELECT state FROM ${this.db.stateTable} WHERE sync_id=$1 AND stream=$2`,
        [this.scope.syncId, stateStream]
      );
      if (!saved.rowCount || this.scope.extraction === "full") return { sourceSequence: 0 };
      const state = readSavedState(saved.rows[0].state, this.scope);
      return state.point.cursor ? state.point : { sourceSequence: 0 };
    });
  }
  async prepareInit(store: JsonObject) {
    ensure(!this.recovery, "Reopen persistence after init recovery before initialization");
    await this.control.transaction(async client => {
      const result = await client.query<ControlRow>(
        `UPDATE reverse_sync_control SET phase='init_prepared',store=$4
         WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND phase='new' RETURNING *`,
        [...this.key, encodeJson(store)]
      );
      ensure(result.rowCount, "Init is already prepared or run has ended");
      this.control.remember(result.rows[0]);
    });
  }
  async acknowledgeInit(store: JsonObject) {
    ensure(!this.recovery, "Recovered init requires explicit reconciliation");
    await this.control.transaction(async client => {
      const result = await client.query<ControlRow>(
        `UPDATE reverse_sync_control SET phase='running',store=$4
         WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND phase='init_prepared' RETURNING *`,
        [...this.key, encodeJson(store)]
      );
      ensure(result.rowCount, "Init is not prepared");
      this.control.remember(result.rows[0]);
    });
  }
  /**
   * Core only: verify the previous init/session is absent or safely cleaned up before
   * authorizing a fresh attempt. Unknown/in-flight initialization is never retryable.
   * Reopen persistence afterwards; the recovery session cannot run fresh init.
   */
  async resetInitAfterReconciliation(resolution: "absent" | "cleaned-up", store: JsonObject) {
    ensure(["absent", "cleaned-up"].includes(resolution), "Invalid init recovery resolution");
    await this.control.transaction(async client => {
      const control = await this.control.lock(client);
      ensure(this.recovery, "Init recovery requires a recovery session");
      // The reset may have committed without its response reaching the caller.
      if (control.phase === "new") return;
      ensure(control.phase === "init_prepared", "Only prepared init can be reset");
      await this.saveStore(client, store);
      await client.query(
        "UPDATE reverse_sync_control SET phase='new',provider_state=NULL WHERE workspace_id=$1 AND sync_id=$2",
        this.key.slice(0, 2)
      );
    });
  }
  async saveProviderState(state: JsonObject) {
    await this.control.transaction(async client => {
      const result = await client.query<ControlRow>(
        `UPDATE reverse_sync_control SET provider_state=$4
         WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND phase NOT IN ('new','complete','aborted') RETURNING *`,
        [...this.key, encodeJson(state)]
      );
      ensure(result.rowCount, "No active provider lifecycle");
      this.control.remember(result.rows[0]);
    });
  }
  async prepare<Row>(batch: PreparedBatch<Row>, store: JsonObject, independent = false) {
    const text = canonicalJson(batch);
    ensure(Buffer.byteLength(text) <= this.db.limits.batchBytes, "Prepared manifest exceeds byte budget");
    const prepared = JSON.parse(text) as PreparedBatch<unknown>;
    ensure(
      ["upsert", "remove"].includes(prepared.action) &&
        prepared.records.length > 0 &&
        prepared.records.length <= this.db.limits.batchRecords,
      "Invalid batch size or action"
    );
    ensure(
      prepared.payloadHash === contentHash(prepared.records.map(r => r.row)) &&
        prepared.batchId ===
          contentHash([this.scope.logicalRunId, prepared.action, prepared.records.map(r => r.operationId)]),
      "Prepared manifest hash mismatch"
    );
    const projected = prepared.records.map(record => effects(this.project(prepared.action, record.row)));
    ensure(
      Buffer.byteLength(canonicalJson(projected)) <= this.db.limits.batchBytes,
      "Projected effects exceed byte budget"
    );
    await this.control.transaction(async client => {
      const control = await this.control.lock(client);
      ensure(control.phase === "running", "Cannot prepare delivery in this phase");
      const unresolved = await client.query(
        "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status IN ('prepared','unknown','rejected') LIMIT 1",
        this.key
      );
      ensure(!unresolved.rowCount, "Outstanding or rejected operation blocks new delivery");
      if (independent) {
        // Independent provider jobs need not complete in source order. Reject
        // overlapping identities instead of letting a late addition undo removal.
        const identities = projected.flatMap(values => values.map(effect => effect.identityHash));
        ensure(new Set(identities).size === identities.length, "Async batches require distinct member identities");
        const overlap = await client.query(
          "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND identity_hashes && $4::text[] LIMIT 1",
          [...this.key, identities]
        );
        ensure(!overlap.rowCount, "Async extraction requires distinct member identities");
      }
      if (control.mode === "mirror" && prepared.action === "remove") {
        await this.snapshots.assertRemovalsAllowed(client);
        for (const projection of projected)
          for (const effect of projection) {
            const desired = await client.query(
              "SELECT 1 FROM reverse_sync_desired WHERE workspace_id=$1 AND sync_id=$2 AND generation=$3 AND identity_hash=$4",
              [...this.key, effect.identityHash]
            );
            ensure(!desired.rowCount, "Cannot remove a desired shared identity");
          }
      }
      const manifest = encodeJson(prepared, this.db.limits.batchBytes);
      const encodedEffects = projected.map(values => encodeJson(values, this.db.limits.batchBytes));
      // Reserve worst-case membership growth BEFORE remote submission, including
      // earlier staged batches. Counters avoid rescanning a million-member table.
      const reservations = projected.map(values => ({
        entries: prepared.action === "upsert" ? values.length : 0,
        bytes:
          prepared.action === "upsert"
            ? values.reduce((n, effect) => n + jsonByteBudget(Buffer.byteLength(canonicalJson(effect))), 0)
            : 0,
      }));
      const reservedEntries = reservations.reduce((n, r) => n + r.entries, 0);
      const reservedBytes = reservations.reduce((n, r) => n + r.bytes, 0);
      ensure(
        Number(control.membership_entries) + Number(control.reserved_entries) + reservedEntries <=
          this.db.limits.snapshotEntries &&
          Number(control.membership_bytes) + Number(control.reserved_bytes) + reservedBytes <=
            this.db.limits.snapshotBytes,
        "Effective membership reservation budget exceeded"
      );
      // Reserve bounded result storage as well, including rejected reasons/job IDs.
      const resultBytes = jsonByteBudget(prepared.records.length * 8192 + 512 * 1024);
      const journalBytes = manifest.length + encodedEffects.reduce((n, value) => n + value.length, 0) + resultBytes;
      ensure(
        Number(control.journal_bytes) + journalBytes <= this.db.limits.journalBytes,
        "Recovery journal budget exceeded; retention is required"
      );
      await client.query(
        "INSERT INTO reverse_sync_batch (workspace_id,sync_id,run_id,batch_id,manifest,manifest_hash,result_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [...this.key, prepared.batchId, manifest, contentHash(prepared), resultBytes]
      );
      let sequence = Number(control.next_sequence);
      for (let index = 0; index < prepared.records.length; index++) {
        const record = prepared.records[index];
        ensure(
          /^[a-f0-9]{64}$/.test(record.key) &&
            Number.isSafeInteger(record.sourceSequence) &&
            record.sourceSequence === ++sequence,
          "Source sequence is not contiguous"
        );
        ensure(
          record.operationId ===
            contentHash([
              this.scope.syncId,
              this.scope.logicalRunId,
              this.scope.configRevision,
              this.scope.targetIdentity,
              prepared.action,
              record.key,
              contentHash(record.row),
            ]),
          "Operation identity mismatch"
        );
        await client.query(
          "INSERT INTO reverse_sync_operation (workspace_id,sync_id,run_id,operation_id,batch_id,sequence,action,effects,reserved_entries,reserved_bytes,identity_hashes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            ...this.key,
            record.operationId,
            prepared.batchId,
            sequence,
            prepared.action,
            encodedEffects[index],
            reservations[index].entries,
            reservations[index].bytes,
            projected[index].map(effect => effect.identityHash),
          ]
        );
      }
      await this.saveStore(client, store);
      await client.query(
        "UPDATE reverse_sync_control SET next_sequence=$3,journal_bytes=journal_bytes+$4,reserved_entries=reserved_entries+$5,reserved_bytes=reserved_bytes+$6 WHERE workspace_id=$1 AND sync_id=$2",
        [...this.key.slice(0, 2), sequence, journalBytes, reservedEntries, reservedBytes]
      );
    });
  }
  async loadBatch(batchId: string): Promise<PreparedBatch<unknown>> {
    return this.control.transaction(async client => this.batch(client, batchId));
  }
  async hasRejected() {
    return this.db.transaction(
      async client =>
        !!(
          await client.query(
            "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status='rejected' LIMIT 1",
            this.key
          )
        ).rowCount
    );
  }
  async finalPoint(sequence: number): Promise<ResumePoint> {
    const batchId = await this.db.transaction(
      async client =>
        (
          await client.query<Pick<OperationRow, "batch_id">>(
            "SELECT batch_id FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND sequence=$4",
            [...this.key, sequence]
          )
        ).rows[0]?.batch_id
    );
    if (batchId) {
      const batch = await this.loadBatch(batchId);
      return { sourceSequence: sequence, ...(batch.cursor ? { cursor: batch.cursor } : {}) };
    }
    return this.db.transaction(async client => {
      const row = (
        await client.query<Pick<StateRow, "state">>(
          `SELECT state FROM ${this.db.stateTable} WHERE sync_id=$1 AND stream=$2`,
          [this.scope.syncId, stateStream]
        )
      ).rows[0];
      const saved = row ? readSavedState(row.state, this.scope) : undefined;
      return {
        sourceSequence: sequence,
        ...(this.scope.extraction === "cursor" && saved?.point.cursor ? { cursor: saved.point.cursor } : {}),
      };
    });
  }
  async recoveryStatus() {
    return this.control.observe(control => ({
      phase: control.phase,
      nextSequence: Number(control.next_sequence),
      finishSequence: control.finish_sequence === null ? undefined : Number(control.finish_sequence),
      finish: control.finish_result ? readFinish(control.finish_result).result : undefined,
      providerState: control.provider_state ? decodeJson<JsonObject>(control.provider_state) : {},
    }));
  }
  async recoveryBatch(batchId: string) {
    return this.control.transaction(async client => {
      const batch = await this.batch(client, batchId);
      const saved = await client.query<Pick<BatchRow, "result">>(
        "SELECT result FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4",
        [...this.key, batchId]
      );
      const operations = await client.query<Pick<OperationRow, "operation_id" | "status" | "accepted_at">>(
        "SELECT operation_id,status,accepted_at FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4 ORDER BY sequence",
        [...this.key, batchId]
      );
      return {
        batch,
        result: saved.rows[0].result ? decodeJson<BatchResult>(saved.rows[0].result) : undefined,
        operations: operations.rows.map(row => ({
          operationId: row.operation_id,
          status: row.status,
          acceptedAt: row.accepted_at,
        })),
      };
    });
  }
  private async batch(client: PoolClient, batchId: string): Promise<PreparedBatch<unknown>> {
    const result = await client.query<Pick<BatchRow, "manifest">>(
      "SELECT manifest FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4",
      [...this.key, batchId]
    );
    ensure(result.rowCount, "Prepared batch not found");
    return decodeJson(result.rows[0].manifest);
  }
  async recoveryPage(after = "", limit = 100): Promise<{ batchId: string; status: string }[]> {
    ensure(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000 && after.length <= 512, "Invalid recovery page");
    return this.control.transaction(async client => {
      const result = await client.query<Pick<BatchRow, "batch_id" | "status">>(
        "SELECT batch_id,status FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id>$4 ORDER BY batch_id LIMIT $5",
        [...this.key, after, limit]
      );
      return result.rows.map(row => ({ batchId: row.batch_id, status: row.status }));
    });
  }
  async markUnknown(batchId: string) {
    await this.control.transaction(async client => {
      const control = await this.control.lock(client);
      ensure(control.phase === "running", "Cannot mark unknown in this phase");
      await this.batch(client, batchId);
      await client.query(
        "UPDATE reverse_sync_operation SET status='unknown' WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4 AND status='prepared'",
        [...this.key, batchId]
      );
      await client.query(
        "UPDATE reverse_sync_batch SET status='unknown' WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4 AND status='prepared'",
        [...this.key, batchId]
      );
    });
  }
  /** Timestamp the durable acknowledgement, not the unknown remote delivery time. */
  private async acceptance(client: PoolClient, reconciled: boolean): Promise<Date> {
    ensure(!this.recovery || reconciled, "Recovered acceptance requires explicit reconciliation");
    const {
      rows: [clock],
    } = await client.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    return clock.now;
  }
  async acknowledge(batchId: string, result: BatchResult, store: JsonObject) {
    return this.acknowledgeBatch(batchId, result, store, false);
  }
  /** Only core recovery calls this with evidence from provider reconciliation. */
  async acknowledgeRecovered(batchId: string, input: BatchResult, store: JsonObject) {
    return this.acknowledgeBatch(batchId, input, store, true);
  }
  private async acknowledgeBatch(batchId: string, input: BatchResult, store: JsonObject, reconciled: boolean) {
    await this.control.transaction(async client => {
      const control = await this.control.lock(client);
      ensure(
        control.phase === "running" || (reconciled && control.phase === "batches_pending"),
        "Cannot acknowledge batch in this phase"
      );
      const batch = await this.batch(client, batchId);
      const result = validateBatchResult(batch, input);
      const previousResult = await client.query<Pick<BatchRow, "result" | "result_bytes">>(
        "SELECT result,result_bytes FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4",
        [...this.key, batchId]
      );
      if (previousResult.rows[0].result) {
        const saved = validateBatchResult(batch, decodeJson<BatchResult>(previousResult.rows[0].result));
        if (saved.outcomes.every(outcome => outcome.status === "accepted" || outcome.status === "rejected")) {
          ensure(canonicalReceipt(saved) === canonicalReceipt(result), "Cannot overwrite a terminal batch receipt");
          // A duplicate is read-only: the run store may already belong to a later batch.
          return;
        }
        const incoming = new Map(result.outcomes.map(outcome => [outcome.operationId, outcome]));
        const advancing = saved.outcomes.some(
          outcome => outcome.status === "staged" && incoming.get(outcome.operationId)!.status !== "staged"
        );
        if (!advancing) {
          ensure(canonicalReceipt(saved) === canonicalReceipt(result), "Cannot overwrite an unchanged staged receipt");
          return;
        }
        for (const outcome of saved.outcomes) {
          if (outcome.status !== "staged")
            ensure(
              canonicalJson(outcome) === canonicalJson(incoming.get(outcome.operationId)),
              "Cannot overwrite a terminal receipt"
            );
        }
        if (result.outcomes.some(outcome => outcome.status === "staged")) {
          // Batch-level metadata cannot identify which pending row no longer needs a job/checkpoint.
          const metadata = ({ outcomes, ...rest }: BatchResult) => canonicalJson(rest);
          ensure(metadata(saved) === metadata(result), "Cannot overwrite pending batch metadata");
        }
      }
      let acceptance: Date | undefined;
      for (const outcome of result.outcomes) {
        const {
          rows: [operation],
        } = await client.query<OperationRow>(
          "SELECT * FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND operation_id=$4",
          [...this.key, outcome.operationId]
        );
        ensure(
          operation && (!["accepted", "rejected"].includes(operation.status) || operation.status === outcome.status),
          "Cannot overwrite a terminal receipt"
        );
        // Every unresolved outcome needs reconciliation after takeover, including
        // rejection/staging: neither may erase an uncertain remote acceptance.
        ensure(
          !this.recovery || reconciled || ["accepted", "rejected"].includes(operation.status),
          "Recovered batch requires explicit reconciliation"
        );
        if (outcome.status === "accepted" && operation.status !== "accepted") {
          acceptance ??= await this.acceptance(client, reconciled);
          await this.accept(client, operation, acceptance);
        } else if (operation.status !== "accepted") {
          if (outcome.status === "rejected") await this.releaseReservation(client, operation);
          await client.query(
            "UPDATE reverse_sync_operation SET status=$5 WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND operation_id=$4",
            [...this.key, outcome.operationId, outcome.status]
          );
        }
      }
      const encodedResult = encodeJson(result, batch.records.length * 8192 + 512 * 1024);
      const journalBytes =
        Number(control.journal_bytes) - Number(previousResult.rows[0].result_bytes) + encodedResult.length;
      ensure(journalBytes <= this.db.limits.journalBytes, "Recovery journal result budget exceeded");
      await client.query("UPDATE reverse_sync_control SET journal_bytes=$3 WHERE workspace_id=$1 AND sync_id=$2", [
        ...this.key.slice(0, 2),
        journalBytes,
      ]);
      await client.query(
        "UPDATE reverse_sync_batch SET status='acknowledged',result=$5,result_bytes=$6 WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4",
        [...this.key, batchId, encodedResult, encodedResult.length]
      );
      await this.saveStore(client, store);
    });
  }
  private async accept(client: PoolClient, operation: OperationRow, acceptedAt: Date) {
    const projected = decodeJson<Effect[]>(operation.effects);
    for (const effect of projected) {
      const later = await client.query(
        `SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3
        AND sequence>$4 AND status='accepted' AND identity_hashes @> ARRAY[$5]::text[] LIMIT 1`,
        [...this.key, operation.sequence, effect.identityHash]
      );
      // A delayed acceptance still gets a receipt and releases its reservation, but cannot
      // overwrite a later accepted upsert or resurrect a later accepted removal.
      if (later.rowCount) continue;
      const previous = await client.query<{ bytes: number }>(
        "SELECT octet_length(value) AS bytes FROM reverse_sync_membership WHERE workspace_id=$1 AND sync_id=$2 AND identity_hash=$3",
        [...this.key.slice(0, 2), effect.identityHash]
      );
      const value = encodeJson(effect, this.db.limits.batchBytes);
      if (operation.action === "remove")
        await client.query(
          "DELETE FROM reverse_sync_membership WHERE workspace_id=$1 AND sync_id=$2 AND identity_hash=$3",
          [...this.key.slice(0, 2), effect.identityHash]
        );
      else
        await client.query(
          `INSERT INTO reverse_sync_membership (workspace_id,sync_id,identity_hash,payload_hash,value) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,sync_id,identity_hash) DO UPDATE SET payload_hash=EXCLUDED.payload_hash,value=EXCLUDED.value,last_accepted_at=clock_timestamp()`,
          [...this.key.slice(0, 2), effect.identityHash, effect.payloadHash, value]
        );
      const entryDelta = (operation.action === "upsert" ? 1 : 0) - (previous.rowCount ? 1 : 0);
      const byteDelta = (operation.action === "upsert" ? value.length : 0) - (previous.rows[0]?.bytes ?? 0);
      await client.query(
        "UPDATE reverse_sync_control SET membership_entries=membership_entries+$3,membership_bytes=membership_bytes+$4 WHERE workspace_id=$1 AND sync_id=$2",
        [...this.key.slice(0, 2), entryDelta, byteDelta]
      );
    }
    await this.releaseReservation(client, operation);
    await client.query(
      "UPDATE reverse_sync_operation SET status='accepted',accepted_at=$5 WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND operation_id=$4",
      [...this.key, operation.operation_id, acceptedAt]
    );
  }
  private async releaseReservation(client: PoolClient, operation: OperationRow) {
    await client.query(
      "UPDATE reverse_sync_control SET reserved_entries=reserved_entries-$3,reserved_bytes=reserved_bytes-$4 WHERE workspace_id=$1 AND sync_id=$2",
      [...this.key.slice(0, 2), operation.reserved_entries, operation.reserved_bytes]
    );
    await client.query(
      "UPDATE reverse_sync_operation SET reserved_entries=0,reserved_bytes=0 WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND operation_id=$4",
      [...this.key, operation.operation_id]
    );
  }
  async prepareAbort() {
    await this.control.transaction(async client => {
      const result = await client.query<ControlRow>(
        `UPDATE reverse_sync_control SET phase='abort_prepared'
         WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3
           AND (phase='running' OR (phase='batches_pending' AND NOT EXISTS (
             SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status='staged'
           ))) RETURNING *`,
        this.key
      );
      ensure(result.rowCount, "Cleanup is unsafe in this phase");
      const pending = await client.query(
        "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status IN ('prepared','unknown') LIMIT 1",
        this.key
      );
      ensure(!pending.rowCount, "Unacknowledged operations require reconciliation before cleanup");
      this.control.remember(result.rows[0]);
    });
  }
  async acknowledgeAbort() {
    await this.control.transaction(async client => {
      const control = await this.control.lock(client);
      ensure(control.phase === "abort_prepared", "Cleanup is not prepared");
      const reservations = await client.query<{ entries: string; bytes: string }>(
        "SELECT COALESCE(sum(reserved_entries),0) AS entries,COALESCE(sum(reserved_bytes),0) AS bytes FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status='staged'",
        this.key
      );
      await client.query(
        "UPDATE reverse_sync_control SET reserved_entries=reserved_entries-$3,reserved_bytes=reserved_bytes-$4 WHERE workspace_id=$1 AND sync_id=$2",
        [...this.key.slice(0, 2), reservations.rows[0].entries, reservations.rows[0].bytes]
      );
      await client.query(
        "UPDATE reverse_sync_operation SET reserved_entries=0,reserved_bytes=0 WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status='staged'",
        this.key
      );
      await client.query(
        "UPDATE reverse_sync_operation SET status='cancelled' WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status='staged'",
        this.key
      );
      await client.query(
        "UPDATE reverse_sync_control SET phase='aborted' WHERE workspace_id=$1 AND sync_id=$2",
        this.key.slice(0, 2)
      );
    });
  }
  async prepareFinish(throughSequence: number, store: JsonObject) {
    ensure(Number.isSafeInteger(throughSequence), "Invalid finish boundary");
    await this.control.transaction(async client => {
      // The conditional write acquires the control-row lock; later validation
      // failures roll back this phase/store change with the whole transaction.
      const result = await client.query<ControlRow>(
        `UPDATE reverse_sync_control SET phase='finish_prepared',finish_sequence=$4,store=$5
         WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND next_sequence=$4
           AND (phase='running' OR (phase='batches_pending' AND NOT EXISTS (
             SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status<>'accepted'
           ))) RETURNING *`,
        [...this.key, throughSequence, encodeJson(store)]
      );
      ensure(result.rows[0], "Invalid finish boundary");
      const pending = await client.query(
        "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status NOT IN ('accepted','staged') LIMIT 1",
        this.key
      );
      ensure(!pending.rowCount, "Unresolved/rejected operations prohibit finish");
      if (result.rows[0].mode === "mirror") await this.snapshots.assertPromotable(client);
      this.control.remember(result.rows[0]);
    });
  }
  async sealExtraction(throughSequence: number, store: JsonObject) {
    ensure(Number.isSafeInteger(throughSequence), "Invalid extraction boundary");
    await this.control.transaction(async client => {
      const result = await client.query<ControlRow>(
        `UPDATE reverse_sync_control SET phase='batches_pending',store=$5
         WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND mode='upsert'
           AND phase='running' AND next_sequence=$4
           AND NOT EXISTS (SELECT 1 FROM reverse_sync_operation
             WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status NOT IN ('accepted','staged'))
         RETURNING *`,
        [...this.key, throughSequence, encodeJson(store)]
      );
      ensure(result.rowCount, "Cannot seal incomplete or rejected extraction");
      this.control.remember(result.rows[0]);
    });
  }
  async acknowledgeFinish(result: FinishResult, store: JsonObject) {
    return this.acknowledgeFinishResult(result, store, false);
  }
  /** Only core recovery calls this after verifying the provider's final outcome. */
  async acknowledgeRecoveredFinish(input: FinishResult, store: JsonObject) {
    return this.acknowledgeFinishResult(input, store, true);
  }
  private async acknowledgeFinishResult(input: FinishResult, store: JsonObject, reconciled: boolean) {
    const result = validateFinishResult(input);
    await this.control.transaction(async client => {
      const control = await this.control.lock(client);
      ensure(
        ["finish_prepared", "finish_pending", "finish_resolving"].includes(control.phase),
        "Finish is not prepared"
      );
      if (control.phase === "finish_resolving") {
        ensure(result.delivery === "accepted", "Accepted finish cannot become pending");
        return;
      }
      if (control.phase === "finish_pending" && result.delivery === "pending") {
        const saved = readFinish(control.finish_result);
        ensure(canonicalJson(saved.result) === canonicalJson(result), "Cannot overwrite a pending finish receipt");
        // Keep the original jobs recoverable; duplicate receipts must not rewind the store either.
        return;
      }
      // Finish itself is a remote operation even for empty/already-accepted batches.
      ensure(
        !this.recovery || reconciled || result.delivery !== "accepted",
        "Recovered finish requires explicit reconciliation"
      );
      const staged = await client.query(
        "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status='staged' LIMIT 1",
        this.key
      );
      const accepted =
        result.delivery === "accepted" && staged.rowCount ? await this.acceptance(client, reconciled) : undefined;
      const saved = {
        result,
        ...(accepted
          ? {
              acceptance: {
                at: accepted.toISOString(),
              },
            }
          : {}),
      };
      await this.saveStore(client, store);
      await client.query(
        "UPDATE reverse_sync_control SET phase=$3,finish_result=$4 WHERE workspace_id=$1 AND sync_id=$2",
        [
          ...this.key.slice(0, 2),
          result.delivery === "pending" ? "finish_pending" : "finish_resolving",
          encodeJson(saved, 384 * 1024),
        ]
      );
    });
    if (result.delivery === "pending") return;
    // A crash between chunks leaves finish_resolving + its recorded acknowledgement time.
    // Retry this local resolution, not provider.finish(), after opening a recovery session.
    let done = false;
    while (!done)
      done = await this.control.transaction(async client => {
        const control = await this.control.lock(client);
        ensure(control.phase === "finish_resolving", "Finish resolution phase changed");
        const pending = await client.query<OperationRow>(
          "SELECT * FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status='staged' ORDER BY sequence LIMIT 100",
          this.key
        );
        if (!pending.rowCount) {
          await client.query(
            "UPDATE reverse_sync_control SET phase='finish_accepted' WHERE workspace_id=$1 AND sync_id=$2",
            this.key.slice(0, 2)
          );
          return true;
        }
        const saved = readFinish(control.finish_result).acceptance;
        ensure(saved, "Missing finish acceptance evidence");
        const acceptance = new Date(saved.at);
        for (const operation of pending.rows) await this.accept(client, operation, acceptance);
        return false;
      });
  }
  async commitCheckpoint(point: ResumePoint, store: JsonObject, complete: boolean) {
    ensure(Number.isSafeInteger(point.sourceSequence) && point.sourceSequence >= 0, "Invalid checkpoint sequence");
    const copied = JSON.parse(
      canonicalJson({
        sourceSequence: point.sourceSequence,
        ...(point.cursor === undefined ? {} : { cursor: point.cursor }),
      })
    ) as ResumePoint;
    if (copied.cursor) {
      ensure(
        typeof copied.cursor.value === "string" &&
          Array.isArray(copied.cursor.primaryKeyValues) &&
          copied.cursor.primaryKeyValues.length > 0 &&
          copied.cursor.primaryKeyValues.length <= 8 &&
          copied.cursor.primaryKeyValues.every(v => typeof v === "string"),
        "Invalid checkpoint cursor"
      );
      ensure(Buffer.byteLength(canonicalJson(copied.cursor)) <= 65536, "Checkpoint cursor exceeds byte budget");
    }
    await this.control.transaction(async client => {
      const control = await this.control.lock(client);
      ensure(
        complete
          ? control.phase === "finish_accepted"
          : control.phase === "running" && control.extraction === "cursor" && control.mode === "upsert",
        "Checkpoint is not allowed in this phase"
      );
      const n = copied.sourceSequence;
      ensure(
        n >= Number(control.checkpoint_sequence) && n <= Number(control.next_sequence),
        "Checkpoint is outside the prepared prefix"
      );
      if (complete)
        ensure(
          n === Number(control.finish_sequence) && n === Number(control.next_sequence),
          "Completion must cover all prepared operations"
        );
      const prefix = await client.query<{ n: string }>(
        "SELECT count(*) AS n FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND sequence>$4 AND sequence<=$5 AND status='accepted'",
        [...this.key, control.base_sequence, n]
      );
      ensure(
        Number(prefix.rows[0].n) === n - Number(control.base_sequence),
        "Checkpoint crosses an unaccepted operation"
      );
      if (n > Number(control.base_sequence)) {
        const last = await client.query<Pick<OperationRow, "batch_id">>(
          "SELECT batch_id FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND sequence=$4",
          [...this.key, n]
        );
        const batch = await this.batch(client, last.rows[0].batch_id);
        ensure(
          batch.records[batch.records.length - 1].sourceSequence === n &&
            canonicalJson(batch.cursor ?? null) === canonicalJson(copied.cursor ?? null),
          "Checkpoint cursor does not match its prepared boundary"
        );
      } else {
        const previous = await client.query<Pick<StateRow, "state">>(
          `SELECT state FROM ${this.db.stateTable} WHERE sync_id=$1 AND stream=$2`,
          [this.scope.syncId, stateStream]
        );
        const saved = previous.rowCount ? readSavedState(previous.rows[0].state, this.scope) : undefined;
        const cursor = control.extraction === "cursor" ? saved?.point.cursor : undefined;
        ensure(
          canonicalJson(cursor ?? null) === canonicalJson(copied.cursor ?? null),
          "Empty checkpoint must preserve its starting cursor"
        );
      }
      if (control.mode === "mirror") await this.snapshots.assertPromotable(client);
      const generation = control.mode === "mirror" ? this.scope.logicalRunId : control.committed_generation;
      const state: SavedState = { point: copied, store, ...(generation ? { generation } : {}) };
      const envelope = {
        version: 2,
        workspaceId: this.scope.workspaceId,
        revision: this.scope.configRevision,
        targetHash: contentHash(this.scope.targetIdentity),
        // jsonb cannot represent every protocol string (e.g. NUL). JSON text
        // preserves these values losslessly without encryption or base64.
        value: encodeJson(state, 192 * 1024).toString("utf8"),
      };
      await client.query(
        `INSERT INTO ${this.db.stateTable} (sync_id,stream,state,timestamp) VALUES ($1,$2,$3,clock_timestamp()) ON CONFLICT (sync_id,stream) DO UPDATE SET state=EXCLUDED.state,timestamp=EXCLUDED.timestamp`,
        [this.scope.syncId, stateStream, envelope]
      );
      await this.saveStore(client, store);
      await client.query(
        "UPDATE reverse_sync_control SET checkpoint_sequence=$3,phase=$4,committed_generation=$5 WHERE workspace_id=$1 AND sync_id=$2",
        [...this.key.slice(0, 2), n, complete ? "complete" : control.phase, generation]
      );
    });
  }
}
