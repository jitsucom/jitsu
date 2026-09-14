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
import { encryptedByteBudget } from "./crypto";
import { statePurpose, stateStream, type SavedState } from "./ownership";
import { effects, Snapshots } from "./snapshots";
import { ensure, type Effect, type Project, type Scope } from "./types";

export class Journal implements DeliveryJournal {
  readonly snapshots: Snapshots;
  constructor(
    readonly db: Database,
    readonly scope: Scope,
    private readonly project: Project,
    private readonly recovery: boolean
  ) {
    this.snapshots = new Snapshots(db, scope);
  }
  private get key() {
    return [this.scope.workspaceId, this.scope.syncId, this.scope.logicalRunId];
  }
  private seal(value: unknown, purpose: string, bytes = 65536) {
    return this.db.cipher.seal(value, this.db.aad(this.scope, purpose), bytes);
  }
  private open<T>(value: Buffer, purpose: string) {
    return this.db.cipher.open<T>(value, this.db.aad(this.scope, purpose));
  }
  private async saveStore(client: PoolClient, store: JsonObject) {
    await client.query("UPDATE reverse_sync_control SET store=$3 WHERE workspace_id=$1 AND sync_id=$2", [
      ...this.key.slice(0, 2),
      this.seal(store, "store"),
    ]);
  }
  async state(): Promise<{ store: JsonObject; providerState: JsonObject }> {
    return this.db.owned(this.scope, async (_, control) => ({
      store: control.store ? this.open(control.store, "store") : {},
      providerState: control.provider_state ? this.open(control.provider_state, "provider") : {},
    }));
  }
  async assertReady(): Promise<ResumePoint> {
    return this.db.owned(this.scope, async (client, control) => {
      ensure(control.phase === "new", "Recover previous lifecycle before extraction");
      const unresolved = await client.query(
        "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND status IN ('prepared','unknown','staged') LIMIT 1",
        this.key.slice(0, 2)
      );
      ensure(!unresolved.rowCount, "Unresolved operations require recovery");
      const saved = await client.query(`SELECT state FROM ${this.db.stateTable} WHERE sync_id=$1 AND stream=$2`, [
        this.scope.syncId,
        stateStream,
      ]);
      if (!saved.rowCount || this.scope.extraction === "full") return { sourceSequence: 0 };
      const state = this.open<SavedState>(Buffer.from(saved.rows[0].state.value, "base64"), statePurpose(this.scope));
      return state.point.cursor ? state.point : { sourceSequence: 0 };
    });
  }
  async prepareInit(store: JsonObject) {
    await this.db.owned(this.scope, async (client, control) => {
      ensure(control.phase === "new", "Init is already prepared or run has ended");
      await this.saveStore(client, store);
      await client.query(
        "UPDATE reverse_sync_control SET phase='init_prepared' WHERE workspace_id=$1 AND sync_id=$2",
        this.key.slice(0, 2)
      );
    });
  }
  async acknowledgeInit(store: JsonObject) {
    await this.db.owned(this.scope, async (client, control) => {
      ensure(control.phase === "init_prepared", "Init is not prepared");
      await this.saveStore(client, store);
      await client.query(
        "UPDATE reverse_sync_control SET phase='running' WHERE workspace_id=$1 AND sync_id=$2",
        this.key.slice(0, 2)
      );
    });
  }
  async saveProviderState(state: JsonObject) {
    await this.db.owned(this.scope, async (client, control) => {
      ensure(!["new", "complete", "aborted"].includes(control.phase), "No active provider lifecycle");
      await client.query("UPDATE reverse_sync_control SET provider_state=$3 WHERE workspace_id=$1 AND sync_id=$2", [
        ...this.key.slice(0, 2),
        this.seal(state, "provider"),
      ]);
    });
  }
  async prepare<Row>(batch: PreparedBatch<Row>, store: JsonObject) {
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
    await this.db.owned(this.scope, async (client, control) => {
      ensure(control.phase === "running", "Cannot prepare delivery in this phase");
      const unresolved = await client.query(
        "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status IN ('prepared','unknown','rejected') LIMIT 1",
        this.key
      );
      ensure(!unresolved.rowCount, "Outstanding or rejected operation blocks new delivery");
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
      const manifest = this.seal(
        prepared,
        `batch:${this.scope.logicalRunId}:${prepared.batchId}`,
        this.db.limits.batchBytes
      );
      const encryptedEffects = projected.map((values, index) =>
        this.seal(
          values,
          `effects:${this.scope.logicalRunId}:${prepared.records[index].operationId}`,
          this.db.limits.batchBytes
        )
      );
      // Reserve worst-case membership growth BEFORE remote submission, including
      // earlier staged batches. Counters avoid rescanning a million-member table.
      const reservations = projected.map(values => ({
        entries: prepared.action === "upsert" ? values.length : 0,
        bytes:
          prepared.action === "upsert"
            ? values.reduce((n, effect) => n + encryptedByteBudget(Buffer.byteLength(canonicalJson(effect))), 0)
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
      // Reserve bounded result storage as well; rejected reasons/job IDs remain encrypted.
      const resultBytes = encryptedByteBudget(prepared.records.length * 8192 + 512 * 1024);
      const journalBytes = manifest.length + encryptedEffects.reduce((n, value) => n + value.length, 0) + resultBytes;
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
          "INSERT INTO reverse_sync_operation (workspace_id,sync_id,run_id,operation_id,batch_id,sequence,action,effects,reserved_entries,reserved_bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            ...this.key,
            record.operationId,
            prepared.batchId,
            sequence,
            prepared.action,
            encryptedEffects[index],
            reservations[index].entries,
            reservations[index].bytes,
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
    return this.db.owned(this.scope, async client => this.batch(client, batchId));
  }
  async recoveryStatus() {
    return this.db.owned(this.scope, async (_, control) => ({
      phase: control.phase as string,
      nextSequence: Number(control.next_sequence),
      finishSequence: control.finish_sequence === null ? undefined : Number(control.finish_sequence),
      finish: control.finish_result
        ? this.open<{ result: FinishResult }>(control.finish_result, "finish").result
        : undefined,
      providerState: control.provider_state ? this.open<JsonObject>(control.provider_state, "provider") : {},
    }));
  }
  async recoveryBatch(batchId: string) {
    return this.db.owned(this.scope, async client => {
      const batch = await this.batch(client, batchId);
      const saved = await client.query(
        "SELECT result FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4",
        [...this.key, batchId]
      );
      const operations = await client.query(
        "SELECT operation_id,status,accepted_at FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4 ORDER BY sequence",
        [...this.key, batchId]
      );
      return {
        batch,
        result: saved.rows[0].result
          ? this.open<BatchResult>(saved.rows[0].result, `result:${this.scope.logicalRunId}:${batchId}`)
          : undefined,
        operations: operations.rows.map(row => ({
          operationId: row.operation_id as string,
          status: row.status as string,
          acceptedAt: row.accepted_at as Date | null,
        })),
      };
    });
  }
  private async batch(client: PoolClient, batchId: string): Promise<PreparedBatch<unknown>> {
    const result = await client.query(
      "SELECT manifest FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4",
      [...this.key, batchId]
    );
    ensure(result.rowCount, "Prepared batch not found");
    return this.open(result.rows[0].manifest, `batch:${this.scope.logicalRunId}:${batchId}`);
  }
  async recoveryPage(after = "", limit = 100): Promise<{ batchId: string; status: string }[]> {
    ensure(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000 && after.length <= 512, "Invalid recovery page");
    return this.db.owned(this.scope, async client => {
      const result = await client.query(
        "SELECT batch_id,status FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id>$4 ORDER BY batch_id LIMIT $5",
        [...this.key, after, limit]
      );
      return result.rows.map(row => ({ batchId: row.batch_id, status: row.status }));
    });
  }
  async markUnknown(batchId: string) {
    await this.db.owned(this.scope, async (client, control) => {
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
    } = await client.query("SELECT clock_timestamp() AS now");
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
    await this.db.owned(this.scope, async (client, control) => {
      ensure(control.phase === "running", "Cannot acknowledge batch in this phase");
      const batch = await this.batch(client, batchId);
      const result = validateBatchResult(batch, input);
      let acceptance: Date | undefined;
      for (const outcome of result.outcomes) {
        const {
          rows: [operation],
        } = await client.query(
          "SELECT * FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND operation_id=$4",
          [...this.key, outcome.operationId]
        );
        ensure(
          operation && (!["accepted", "rejected"].includes(operation.status) || operation.status === outcome.status),
          "Cannot overwrite a terminal receipt"
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
      const encryptedResult = this.seal(
        result,
        `result:${this.scope.logicalRunId}:${batchId}`,
        batch.records.length * 8192 + 512 * 1024
      );
      const previousResult = await client.query(
        "SELECT result_bytes FROM reverse_sync_batch WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4",
        [...this.key, batchId]
      );
      const journalBytes =
        Number(control.journal_bytes) - Number(previousResult.rows[0].result_bytes) + encryptedResult.length;
      ensure(journalBytes <= this.db.limits.journalBytes, "Recovery journal result budget exceeded");
      await client.query("UPDATE reverse_sync_control SET journal_bytes=$3 WHERE workspace_id=$1 AND sync_id=$2", [
        ...this.key.slice(0, 2),
        journalBytes,
      ]);
      await client.query(
        "UPDATE reverse_sync_batch SET status='acknowledged',result=$5,result_bytes=$6 WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND batch_id=$4",
        [...this.key, batchId, encryptedResult, encryptedResult.length]
      );
      await this.saveStore(client, store);
    });
  }
  private async accept(client: PoolClient, operation: any, acceptedAt: Date) {
    const projected = this.open<Effect[]>(
      operation.effects,
      `effects:${this.scope.logicalRunId}:${operation.operation_id}`
    );
    for (const effect of projected) {
      const previous = await client.query(
        "SELECT octet_length(value) AS bytes FROM reverse_sync_membership WHERE workspace_id=$1 AND sync_id=$2 AND identity_hash=$3",
        [...this.key.slice(0, 2), effect.identityHash]
      );
      const value = this.seal(effect, `identity:${effect.identityHash}`, this.db.limits.batchBytes);
      if (operation.action === "remove")
        await client.query(
          "DELETE FROM reverse_sync_membership WHERE workspace_id=$1 AND sync_id=$2 AND identity_hash=$3",
          [...this.key.slice(0, 2), effect.identityHash]
        );
      else
        await client.query(
          `INSERT INTO reverse_sync_membership (workspace_id,sync_id,identity_hash,payload_hash,value) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,sync_id,identity_hash) DO UPDATE SET payload_hash=EXCLUDED.payload_hash,value=EXCLUDED.value`,
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
  private async releaseReservation(client: PoolClient, operation: any) {
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
    await this.db.owned(this.scope, async (client, control) => {
      ensure(control.phase === "running", "Cleanup is unsafe in this phase");
      const pending = await client.query(
        "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status IN ('prepared','unknown') LIMIT 1",
        this.key
      );
      ensure(!pending.rowCount, "Unacknowledged operations require reconciliation before cleanup");
      await client.query(
        "UPDATE reverse_sync_control SET phase='abort_prepared' WHERE workspace_id=$1 AND sync_id=$2",
        this.key.slice(0, 2)
      );
    });
  }
  async acknowledgeAbort() {
    await this.db.owned(this.scope, async (client, control) => {
      ensure(control.phase === "abort_prepared", "Cleanup is not prepared");
      const reservations = await client.query(
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
    await this.db.owned(this.scope, async (client, control) => {
      ensure(
        control.phase === "running" &&
          Number.isSafeInteger(throughSequence) &&
          throughSequence === Number(control.next_sequence),
        "Invalid finish boundary"
      );
      const pending = await client.query(
        "SELECT 1 FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND status NOT IN ('accepted','staged') LIMIT 1",
        this.key
      );
      ensure(!pending.rowCount, "Unresolved/rejected operations prohibit finish");
      if (control.mode === "mirror") await this.snapshots.assertPromotable(client);
      await this.saveStore(client, store);
      await client.query(
        "UPDATE reverse_sync_control SET phase='finish_prepared',finish_sequence=$3 WHERE workspace_id=$1 AND sync_id=$2",
        [...this.key.slice(0, 2), throughSequence]
      );
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
    await this.db.owned(this.scope, async (client, control) => {
      ensure(
        ["finish_prepared", "finish_pending", "finish_resolving"].includes(control.phase),
        "Finish is not prepared"
      );
      if (control.phase === "finish_resolving") {
        ensure(result.delivery === "accepted", "Accepted finish cannot become pending");
        return;
      }
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
          this.seal(saved, "finish", 384 * 1024),
        ]
      );
    });
    if (result.delivery === "pending") return;
    // A crash between chunks leaves finish_resolving + its recorded acknowledgement time.
    // Retry this local resolution, not provider.finish(), after acquiring a new epoch.
    let done = false;
    while (!done)
      done = await this.db.owned(this.scope, async (client, control) => {
        ensure(control.phase === "finish_resolving", "Finish resolution ownership changed");
        const pending = await client.query(
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
        const saved = this.open<any>(control.finish_result, "finish").acceptance;
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
    await this.db.owned(this.scope, async (client, control) => {
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
      const prefix = await client.query(
        "SELECT count(*) AS n FROM reverse_sync_operation WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 AND sequence>$4 AND sequence<=$5 AND status='accepted'",
        [...this.key, control.base_sequence, n]
      );
      ensure(
        Number(prefix.rows[0].n) === n - Number(control.base_sequence),
        "Checkpoint crosses an unaccepted operation"
      );
      if (n > Number(control.base_sequence)) {
        const last = await client.query(
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
        const previous = await client.query(`SELECT state FROM ${this.db.stateTable} WHERE sync_id=$1 AND stream=$2`, [
          this.scope.syncId,
          stateStream,
        ]);
        const saved = previous.rowCount
          ? this.open<SavedState>(Buffer.from(previous.rows[0].state.value, "base64"), statePurpose(this.scope))
          : undefined;
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
        version: 1,
        workspaceId: this.scope.workspaceId,
        revision: this.scope.configRevision,
        targetHash: contentHash(this.scope.targetIdentity),
        value: this.seal(state, statePurpose(this.scope), 192 * 1024).toString("base64"),
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
