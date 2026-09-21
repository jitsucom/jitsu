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
import { Database } from "../persistence/database";
import { controlFor, type ControlCache } from "../persistence/control-cache";
import { encodeJson, decodeJson } from "../persistence/serialization";
import { readSavedState, stateStream, type SavedState } from "../persistence/run-state";
import type { ControlRow, StateRow } from "../persistence/rows";
import { effects } from "../persistence/effects";
import { ensure, PersistenceError, type Project, type Scope, type Effect } from "../persistence/types";
import { Artifacts, type ArtifactRef } from "./store";
import { LocalIndex, type Member } from "./local";
import { ObjectSnapshots } from "./snapshots";
import type { ArtifactHead, BatchHead, BatchData, ReceiptData, StoredBatchData } from "./state";

const receiptKey = (result: BatchResult) =>
  canonicalJson({ ...result, outcomes: Object.fromEntries(result.outcomes.map(row => [row.operationId, row])) });
const copy = <T>(value: T): T => JSON.parse(canonicalJson(value));
class TransitionConflict extends PersistenceError {}
type Changes = Partial<
  Pick<
    ControlRow,
    | "phase"
    | "store"
    | "provider_state"
    | "finish_result"
    | "finish_sequence"
    | "next_sequence"
    | "checkpoint_sequence"
    | "committed_generation"
    | "detached"
  >
>;

/** Immutable artifacts + one atomic PostgreSQL head update; SQLite is only a replayable index. */
export class ObjectJournal implements DeliveryJournal {
  readonly snapshots: ObjectSnapshots;
  readonly artifacts: Artifacts;
  head: ArtifactHead;
  private headBytes: Buffer | null;
  private broken = false;
  private readonly cache: ControlCache;
  /** Core-only observability, not exposed through the provider's delivery facade. */
  onPublish?: (head: ArtifactHead) => Promise<void>;
  private constructor(
    readonly db: Database,
    readonly scope: Scope,
    private readonly projection: Project,
    private readonly recovered: boolean,
    readonly local: LocalIndex,
    head: ArtifactHead,
    headBytes: Buffer | null,
    artifacts: Artifacts
  ) {
    this.head = head;
    this.headBytes = headBytes;
    this.artifacts = artifacts;
    this.cache = controlFor(db, scope);
    this.snapshots = new ObjectSnapshots(this);
  }
  static async open(db: Database, scope: Scope, project: Project, recovery: boolean) {
    ensure(db.objectStorage, "Object storage is required");
    const artifacts = new Artifacts(db.objectStorage.store, scope, db.objectStorage.signal);
    const control = await controlFor(db, scope).observe(value => value);
    ensure(control.artifact_head, "Artifact head is required; legacy state requires an explicit test-sync reset");
    const head = await artifacts.get<ArtifactHead>(decodeJson(control.artifact_head));
    ensure(
      head.version === 1 && Array.isArray(head.baseline) && Array.isArray(head.batches),
      "Invalid artifact manifest"
    );
    const local = await LocalIndex.create();
    const journal = new ObjectJournal(db, scope, project, recovery, local, head, control.artifact_head, artifacts);
    try {
      await journal.restore();
      if (head.runId !== scope.logicalRunId) {
        ensure(
          !head.batches.some(batch => batch.status === "prepared" || batch.status === "unknown"),
          "Unresolved artifact batches require recovery"
        );
        // Pending memberships are candidates, not acknowledged baseline. Preserve
        // them for later removals and force a refresh if desired by the newer run.
        for (const batch of head.batches.filter(batch => batch.staged > 0)) {
          const data = await journal.data(batch);
          const receipt = await artifacts.get<ReceiptData>(batch.receipt);
          const pending = new Set(
            receipt.result.outcomes.filter(row => row.status === "staged").map(row => row.operationId)
          );
          data.batch.records.forEach((record, i) => {
            if (pending.has(record.operationId))
              for (const effect of data.effects[i])
                local.apply(effect, "upsert", record.sourceSequence, new Date(0).toISOString(), true);
          });
        }
        if (
          head.batches.some(batch => batch.staged > 0) ||
          (head.snapshot?.strategy === "native-replace" && head.snapshot.replacementStatus !== "accepted")
        )
          local.sql.exec("UPDATE members SET uncertain=1");
        const baseline: ArtifactRef[] = [];
        for (const page of local.memberPages()) baseline.push(await artifacts.put(page));
        journal.head = { version: 1, runId: scope.logicalRunId, baseline, batches: [] };
        local.sql.exec(
          "DELETE FROM desired; DELETE FROM operations; DELETE FROM touched; DELETE FROM members WHERE value IS NULL; UPDATE members SET sequence=0;"
        );
      }
      if (head.runId !== scope.logicalRunId) await journal.publish(journal.head);
      db.onClose(() => local.close());
      return journal;
    } catch (error) {
      await local.close();
      throw error;
    }
  }
  private async restore() {
    for (const ref of this.head.baseline) this.local.restoreMembers(await this.artifacts.get<Member[]>(ref));
    if (this.head.snapshot?.sealed)
      for (const ref of this.head.snapshot.parts) this.local.restoreDesired(await this.artifacts.get<Effect[]>(ref));
    for (const batch of [...this.head.batches].sort((a, b) => a.first - b.first)) {
      const data = await this.data(batch);
      const receipt = batch.receipt ? await this.artifacts.get<ReceiptData>(batch.receipt) : undefined;
      this.index(batch, data, receipt);
    }
    if (this.head.snapshot?.strategy === "native-replace" && this.head.snapshot.replacementStatus === "accepted")
      this.local.applyReplacement();
  }
  current() {
    ensure(!this.broken, "Artifact session requires reopening after a failed commit");
    return this.cache.observe(value => value);
  }
  async publish(head: ArtifactHead, changes: Changes = {}, checkpoint?: SavedState, expectedPhase?: string) {
    ensure(!this.broken, "Artifact session requires reopening after a failed commit");
    this.artifacts.signal.throwIfAborted();
    const owned = copy(head);
    const existing = this.headBytes ? decodeJson<ArtifactRef>(this.headBytes) : undefined;
    const headBytes =
      existing?.sha256 === contentHash({ version: 1, value: owned })
        ? this.headBytes!
        : encodeJson(await this.artifacts.put(owned));
    try {
      await this.cache.transaction(async client => {
        const old = await this.cache.lock(client);
        if (expectedPhase !== undefined && old.phase !== expectedPhase)
          throw new TransitionConflict("Lifecycle phase changed; transition rejected");
        ensure(
          (old.artifact_head === null && this.headBytes === null) || !!old.artifact_head?.equals(this.headBytes!),
          "Artifact head changed; reopen recovery"
        );
        const next = { ...old, ...changes };
        if (checkpoint) {
          const envelope = {
            version: 2,
            workspaceId: this.scope.workspaceId,
            revision: this.scope.configRevision,
            targetHash: contentHash(this.scope.targetIdentity),
            runOrder: old.run_order,
            value: encodeJson(checkpoint, 192 * 1024).toString("utf8"),
          };
          await client.query(
            `INSERT INTO ${this.db.stateTable}(sync_id,stream,state,timestamp) VALUES($1,$2,$3,clock_timestamp())
             ON CONFLICT(sync_id,stream) DO UPDATE SET state=EXCLUDED.state,timestamp=EXCLUDED.timestamp
             WHERE COALESCE((${this.db.stateTable}.state->>'runOrder')::bigint,0) <= ($3::jsonb->>'runOrder')::bigint`,
            [this.scope.syncId, stateStream, envelope]
          );
        }
        const result = await client.query<ControlRow>(
          `UPDATE reverse_sync_control SET artifact_head=$4,phase=$5,store=$6,provider_state=$7,finish_result=$8,
          finish_sequence=$9,next_sequence=$10,checkpoint_sequence=$11,committed_generation=$12,detached=$13
          WHERE workspace_id=$1 AND sync_id=$2 AND run_id=$3 RETURNING *`,
          [
            this.scope.workspaceId,
            this.scope.syncId,
            this.scope.logicalRunId,
            headBytes,
            next.phase,
            next.store,
            next.provider_state,
            next.finish_result,
            next.finish_sequence,
            next.next_sequence,
            next.checkpoint_sequence,
            next.committed_generation,
            next.detached,
          ]
        );
        ensure(result.rowCount, "Run state changed");
        this.cache.remember(result.rows[0]);
      });
      this.head = owned;
      this.headBytes = headBytes;
    } catch (error) {
      if (!(error instanceof TransitionConflict)) this.broken = true;
      throw error;
    }
    // A log outage must not turn a committed receipt into a delivery failure.
    try {
      await this.onPublish?.(this.head);
    } catch {
      process.stderr.write('{"event":"reverse_etl_progress_unavailable"}\n');
    }
  }
  private find(id: string) {
    const value = this.head.batches.find(batch => batch.id === id);
    ensure(value, "Prepared batch not found");
    return value;
  }
  private async data(head: BatchHead) {
    const stored = await this.artifacts.get<StoredBatchData>(head.data);
    ensure(stored.effects !== null || this.scope.mode === "mirror", "Missing projected effects");
    const data: BatchData = {
      batch: stored.batch,
      effects: stored.effects
        ? await this.artifacts.get<Effect[][]>(stored.effects)
        : stored.batch.records.map(record => [record.row as Effect]),
    };
    ensure(
      data.batch.batchId === head.id &&
        data.batch.records.length === head.last - head.first + 1 &&
        data.effects.length === data.batch.records.length,
      "Invalid batch artifact binding"
    );
    return data;
  }
  private index(head: BatchHead, data: BatchData, receipt?: ReceiptData) {
    const result = receipt ? validateBatchResult(data.batch, receipt.result) : undefined;
    const outcomes = new Map(result?.outcomes.map(outcome => [outcome.operationId, outcome]));
    const put = this.local.sql.prepare(
      "INSERT INTO operations VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status"
    );
    const touch = this.local.sql.prepare("INSERT OR IGNORE INTO touched VALUES(?)");
    this.local.transaction(() => {
      data.batch.records.forEach((record, index) => {
        const outcome = outcomes.get(record.operationId)?.status;
        const status = outcome === "staged" && head.status === "cancelled" ? "cancelled" : outcome ?? head.status;
        put.run(record.operationId, record.sourceSequence, status, head.id);
        for (const effect of data.effects[index]) {
          touch.run(effect.identityHash);
          if (status === "accepted") {
            const at = receipt!.acceptedAt[record.operationId];
            ensure(typeof at === "string" && Number.isFinite(Date.parse(at)), "Missing acceptance evidence");
            this.local.apply(effect, data.batch.action, record.sourceSequence, at);
          }
        }
      });
    });
  }
  async state() {
    const c = await this.current();
    return {
      store: c.store ? decodeJson<JsonObject>(c.store) : {},
      providerState: c.provider_state ? decodeJson<JsonObject>(c.provider_state) : {},
    };
  }
  private async saved() {
    return this.db.transaction(async client => {
      const row = (
        await client.query<Pick<StateRow, "state">>(
          `SELECT state FROM ${this.db.stateTable} WHERE sync_id=$1 AND stream=$2`,
          [this.scope.syncId, stateStream]
        )
      ).rows[0];
      return row ? readSavedState(row.state, this.scope) : undefined;
    });
  }
  async assertReady() {
    const c = await this.current();
    ensure(c.phase === "new" && !this.recovered, "Recover previous lifecycle before extraction");
    ensure(!this.head.batches.length, "Unresolved operations require recovery");
    return this.scope.extraction === "cursor"
      ? (await this.saved())?.point ?? { sourceSequence: 0 }
      : { sourceSequence: 0 };
  }
  async prepareInit(store: JsonObject) {
    store = copy(store);
    ensure(!this.recovered && (await this.current()).phase === "new", "Initialization is not allowed");
    await this.publish(this.head, { phase: "init_prepared", store: encodeJson(store) }, undefined, "new");
  }
  async acknowledgeInit(store: JsonObject) {
    store = copy(store);
    ensure(!this.recovered && (await this.current()).phase === "init_prepared", "Initialization is not prepared");
    await this.publish(this.head, { phase: "running", store: encodeJson(store) }, undefined, "init_prepared");
  }
  async resetInitAfterReconciliation(resolution: "absent" | "cleaned-up", store: JsonObject) {
    store = copy(store);
    ensure(this.recovered && ["absent", "cleaned-up"].includes(resolution), "Initialization requires reconciliation");
    const c = await this.current();
    if (c.phase === "new") return;
    ensure(c.phase === "init_prepared", "Only prepared initialization can be reset");
    await this.publish(this.head, { phase: "new", store: encodeJson(store), provider_state: null }, undefined, c.phase);
  }
  async saveProviderState(state: JsonObject) {
    state = copy(state);
    ensure(!["new", "complete", "aborted"].includes((await this.current()).phase), "No active provider lifecycle");
    await this.publish(this.head, { provider_state: encodeJson(state) });
  }
  async prepare<Row>(batch: PreparedBatch<Row>, store: JsonObject, independent = false) {
    batch = copy(batch);
    store = copy(store);
    const control = await this.current();
    ensure(control.phase === "running", "Cannot prepare delivery in this phase");
    const prepared = copy(batch) as PreparedBatch<unknown>;
    const n = prepared.records.length;
    ensure(
      n > 0 && n <= this.db.limits.batchRecords && ["upsert", "remove"].includes(prepared.action),
      "Invalid batch size or action"
    );
    ensure(
      Buffer.byteLength(canonicalJson(prepared)) <= this.db.limits.batchBytes,
      "Prepared manifest exceeds byte budget"
    );
    ensure(
      prepared.payloadHash === contentHash(prepared.records.map(row => row.row)) &&
        prepared.batchId ===
          contentHash([this.scope.logicalRunId, prepared.action, prepared.records.map(row => row.operationId)]),
      "Prepared manifest hash mismatch"
    );
    ensure(
      !this.head.batches.some(head => head.status === "prepared" || head.status === "unknown" || head.rejected > 0),
      "Outstanding or rejected operation blocks new delivery"
    );
    const projected = prepared.records.map(record => effects(this.projection(prepared.action, record.row)));
    ensure(
      Buffer.byteLength(canonicalJson(projected)) <= this.db.limits.batchBytes,
      "Projected effects exceed byte budget"
    );
    let sequence = Number(control.next_sequence);
    const seen = new Set<string>();
    const operationIds = new Set<string>();
    for (let i = 0; i < n; i++) {
      const record = prepared.records[i];
      ensure(
        !operationIds.has(record.operationId) &&
          !this.local.sql.prepare("SELECT 1 FROM operations WHERE id=?").get(record.operationId),
        "Duplicate input operation IDs"
      );
      operationIds.add(record.operationId);
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
      for (const effect of projected[i]) {
        if (independent || this.head.snapshot?.strategy === "native-replace")
          ensure(
            !seen.has(effect.identityHash) &&
              !this.local.sql.prepare("SELECT 1 FROM touched WHERE identity=?").get(effect.identityHash),
            "Async batches require distinct member identities"
          );
        seen.add(effect.identityHash);
        if (this.scope.mode === "mirror" && prepared.action === "remove")
          ensure(
            !this.local.sql.prepare("SELECT 1 FROM desired WHERE identity=?").get(effect.identityHash),
            "Cannot remove desired shared identity"
          );
      }
    }
    if (this.scope.mode === "mirror") {
      ensure(this.head.snapshot?.sealed, "Full source must be sealed before delivery");
      if (this.head.snapshot.strategy === "native-replace") {
        ensure(prepared.action === "upsert", "Native replacement does not use individual removals");
        for (const values of projected)
          for (const effect of values) {
            const desired = this.local.sql
              .prepare("SELECT value FROM desired WHERE identity=?")
              .get(effect.identityHash);
            ensure(desired?.value === canonicalJson(effect), "Replacement upload is outside the sealed snapshot");
            ensure(
              !this.local.sql.prepare("SELECT 1 FROM touched WHERE identity=?").get(effect.identityHash),
              "Replacement identity already prepared"
            );
          }
      }
      if (prepared.action === "remove") await this.snapshots.assertRemovalsAllowed();
    }
    const reservedEntries = prepared.action === "upsert" ? projected.flat().length : 0;
    const reservedBytes = prepared.action === "upsert" ? Buffer.byteLength(canonicalJson(projected)) : 0;
    const current = this.local.stats();
    ensure(
      current.entries + this.head.batches.reduce((n, b) => n + b.reservedEntries, 0) + reservedEntries <=
        this.db.limits.snapshotEntries &&
        current.bytes + this.head.batches.reduce((n, b) => n + b.reservedBytes, 0) + reservedBytes <=
          this.db.limits.snapshotBytes,
      "Effective membership reservation budget exceeded"
    );
    const resultBudget = n * 8192 + 512 * 1024;
    ensure(
      this.head.batches.reduce(
        (sum, b) => sum + b.data.bytes + b.effectBytes + (b.receipt?.bytes ?? b.resultBudget),
        0
      ) +
        Buffer.byteLength(canonicalJson({ batch: prepared, effects: projected })) +
        resultBudget <=
        this.db.limits.journalBytes,
      "Recovery journal budget exceeded"
    );
    const data: BatchData = { batch: prepared, effects: projected };
    const projectionRef = this.scope.mode === "mirror" ? null : await this.artifacts.put(projected);
    if (this.scope.mode === "mirror")
      ensure(
        projected.every(
          (values, i) => values.length === 1 && canonicalJson(values[0]) === canonicalJson(prepared.records[i].row)
        ),
        "Mirror batch must contain exact effect envelopes"
      );
    const head: BatchHead = {
      id: prepared.batchId,
      action: prepared.action,
      first: sequence - n + 1,
      last: sequence,
      data: await this.artifacts.put({ batch: prepared, effects: projectionRef } satisfies StoredBatchData),
      effectBytes: projectionRef?.bytes ?? 0,
      status: "prepared",
      accepted: 0,
      staged: 0,
      rejected: 0,
      reservedEntries,
      reservedBytes,
      resultBudget,
    };
    await this.publish(
      { ...this.head, batches: [...this.head.batches, head] },
      { next_sequence: String(sequence), store: encodeJson(store) }
    );
    this.index(head, data);
  }
  async loadBatch(id: string) {
    return (await this.data(this.find(id))).batch;
  }
  async recoveryStatus() {
    const c = await this.current();
    return {
      phase: c.phase,
      nextSequence: Number(c.next_sequence),
      finishSequence: c.finish_sequence === null ? undefined : Number(c.finish_sequence),
      finish: c.finish_result ? decodeJson<{ result: FinishResult }>(c.finish_result).result : undefined,
      providerState: c.provider_state ? decodeJson<JsonObject>(c.provider_state) : {},
    };
  }
  async recoveryPage(after = "", limit = 100) {
    ensure(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000, "Invalid recovery page");
    return this.head.batches
      .filter(row => row.id > after)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(row => ({ batchId: row.id, status: row.status }));
  }
  async recoveryBatch(id: string) {
    const head = this.find(id),
      data = await this.data(head);
    const receipt = head.receipt ? await this.artifacts.get<ReceiptData>(head.receipt) : undefined;
    const outcomes = new Map(receipt?.result.outcomes.map(row => [row.operationId, row.status]));
    return {
      batch: data.batch,
      result: receipt?.result,
      operations: data.batch.records.map(row => ({
        operationId: row.operationId,
        status:
          outcomes.get(row.operationId) === "staged" && head.status === "cancelled"
            ? "cancelled"
            : outcomes.get(row.operationId) ?? head.status,
        acceptedAt: receipt?.acceptedAt[row.operationId] ? new Date(receipt.acceptedAt[row.operationId]) : null,
      })),
    };
  }
  async markUnknown(id: string) {
    ensure((await this.current()).phase === "running", "Cannot mark unknown in this phase");
    const old = this.find(id);
    if (old.status !== "prepared") return;
    await this.publish({
      ...this.head,
      batches: this.head.batches.map(row => (row.id === id ? { ...row, status: "unknown" } : row)),
    });
  }
  async acknowledge(id: string, result: BatchResult, store: JsonObject) {
    await this.ack(id, result, store, false);
  }
  async acknowledgeRecovered(id: string, result: BatchResult, store: JsonObject) {
    await this.ack(id, result, store, true);
  }
  private async ack(id: string, input: BatchResult, store: JsonObject, reconciled: boolean, finishAt?: string) {
    input = copy(input);
    store = copy(store);
    const c = await this.current();
    ensure(
      c.phase === "running" ||
        (reconciled && c.phase === "batches_pending") ||
        (finishAt && c.phase === "finish_resolving"),
      "Cannot acknowledge batch in this phase"
    );
    const old = this.find(id),
      data = await this.data(old);
    const result = copy(validateBatchResult(data.batch, input));
    const previous = old.receipt ? await this.artifacts.get<ReceiptData>(old.receipt) : undefined;
    if (previous) {
      const incoming = new Map(result.outcomes.map(row => [row.operationId, row]));
      for (const row of previous.result.outcomes)
        if (row.status !== "staged")
          ensure(
            canonicalJson(row) === canonicalJson(incoming.get(row.operationId)),
            "Cannot overwrite a terminal receipt"
          );
      const advancing = previous.result.outcomes.some(
        row => row.status === "staged" && incoming.get(row.operationId)?.status !== "staged"
      );
      if (!advancing) {
        ensure(receiptKey(previous.result) === receiptKey(result), "Cannot overwrite an unchanged receipt");
        return;
      }
      if (result.outcomes.some(row => row.status === "staged")) {
        const metadata = ({ outcomes, ...rest }: BatchResult) => canonicalJson(rest);
        ensure(metadata(previous.result) === metadata(result), "Cannot overwrite pending batch metadata");
      }
    }
    ensure(!this.recovered || reconciled, "Recovered batch requires explicit reconciliation");
    const acceptedAt = { ...previous?.acceptedAt };
    const now = finishAt ?? new Date().toISOString();
    for (const row of result.outcomes) if (row.status === "accepted") acceptedAt[row.operationId] ??= now;
    const staged = result.outcomes.filter(row => row.status === "staged").length;
    const unresolved = new Set(result.outcomes.filter(row => row.status === "staged").map(row => row.operationId));
    const retained = data.effects.filter((_, i) => unresolved.has(data.batch.records[i].operationId));
    const updated: BatchHead = {
      ...old,
      receipt: await this.artifacts.put({ result, acceptedAt } satisfies ReceiptData),
      status: "acknowledged",
      accepted: result.outcomes.filter(row => row.status === "accepted").length,
      staged,
      rejected: result.outcomes.filter(row => row.status === "rejected").length,
      submittedRecords: Math.max(
        old.submittedRecords ?? old.accepted + old.staged,
        result.remoteJobIds?.length
          ? result.outcomes.length
          : result.outcomes.filter(row => row.status !== "rejected").length
      ),
      reservedEntries: data.batch.action === "upsert" ? retained.flat().length : 0,
      reservedBytes: data.batch.action === "upsert" && retained.length ? Buffer.byteLength(canonicalJson(retained)) : 0,
    };
    ensure(updated.receipt!.bytes <= old.resultBudget + 512 * 1024, "Recovery receipt exceeds byte budget");
    await this.publish(
      { ...this.head, batches: this.head.batches.map(row => (row.id === id ? updated : row)) },
      { store: encodeJson(store) }
    );
    this.index(updated, data, { result, acceptedAt });
  }
  async prepareAbort() {
    const c = await this.current();
    ensure(["running", "batches_pending"].includes(c.phase), "Cleanup is unsafe in this phase");
    ensure(
      !this.head.batches.some(
        row =>
          row.status === "prepared" || row.status === "unknown" || (c.phase === "batches_pending" && row.staged > 0)
      ),
      "Unacknowledged operations require reconciliation before cleanup"
    );
    await this.publish(this.head, { phase: "abort_prepared" }, undefined, c.phase);
  }
  async acknowledgeAbort() {
    ensure((await this.current()).phase === "abort_prepared", "Cleanup is not prepared");
    await this.publish(
      {
        ...this.head,
        batches: this.head.batches.map(row =>
          row.staged ? { ...row, status: "cancelled", staged: 0, reservedEntries: 0, reservedBytes: 0 } : row
        ),
      },
      { phase: "aborted" },
      undefined,
      "abort_prepared"
    );
  }
  async prepareFinish(sequence: number, store: JsonObject) {
    store = copy(store);
    const c = await this.current();
    ensure(
      Number.isSafeInteger(sequence) &&
        Number(c.next_sequence) === sequence &&
        ["running", "batches_pending"].includes(c.phase),
      "Invalid finish boundary"
    );
    ensure(
      !this.head.batches.some(
        row =>
          row.status === "prepared" ||
          row.status === "unknown" ||
          row.rejected > 0 ||
          (c.phase === "batches_pending" && row.staged > 0)
      ),
      "Unresolved/rejected operations prohibit finish"
    );
    const replacement = this.head.snapshot?.strategy === "native-replace";
    if (replacement) await this.snapshots.assertReplacementReady();
    else if (this.scope.mode === "mirror") await this.snapshots.assertPromotable();
    await this.publish(
      replacement ? { ...this.head, snapshot: { ...this.head.snapshot!, replacementStatus: "prepared" } } : this.head,
      {
        phase: "finish_prepared",
        finish_sequence: String(sequence),
        store: encodeJson(store),
      },
      undefined,
      c.phase
    );
  }
  async sealExtraction(sequence: number, store: JsonObject) {
    store = copy(store);
    const c = await this.current();
    ensure(
      this.scope.mode === "upsert" &&
        c.phase === "running" &&
        Number.isSafeInteger(sequence) &&
        sequence === Number(c.next_sequence) &&
        !this.head.batches.some(row => row.status === "prepared" || row.status === "unknown" || row.rejected > 0),
      "Cannot seal incomplete or rejected extraction"
    );
    await this.publish(this.head, { phase: "batches_pending", store: encodeJson(store) }, undefined, c.phase);
  }
  async acknowledgeFinish(result: FinishResult, store: JsonObject) {
    await this.finish(result, store, false);
  }
  async acknowledgeRecoveredFinish(result: FinishResult, store: JsonObject) {
    await this.finish(result, store, true);
  }
  private async finish(input: FinishResult, store: JsonObject, reconciled: boolean) {
    input = copy(input);
    store = copy(store);
    const result = copy(validateFinishResult(input)),
      c = await this.current();
    ensure(["finish_prepared", "finish_pending", "finish_resolving"].includes(c.phase), "Finish is not prepared");
    ensure(
      !this.recovered || reconciled || result.delivery !== "accepted" || c.phase === "finish_resolving",
      "Recovered finish requires explicit reconciliation"
    );
    if (c.phase === "finish_pending" && result.delivery === "pending") {
      ensure(
        canonicalJson(decodeJson<{ result: FinishResult }>(c.finish_result!).result) === canonicalJson(result),
        "Cannot overwrite pending finish receipt"
      );
      return;
    }
    ensure(c.phase !== "finish_resolving" || result.delivery === "accepted", "Accepted finish cannot become pending");
    const at =
      c.phase === "finish_resolving" ? decodeJson<{ at: string }>(c.finish_result!).at : new Date().toISOString();
    if (c.phase !== "finish_resolving")
      await this.publish(
        this.head.snapshot?.strategy === "native-replace" && result.delivery === "pending"
          ? { ...this.head, snapshot: { ...this.head.snapshot, replacementStatus: "pending" } }
          : this.head,
        {
          phase: result.delivery === "pending" ? "finish_pending" : "finish_resolving",
          finish_result: encodeJson({ result, at }, 384 * 1024),
          store: encodeJson(store),
        }
      );
    if (result.delivery === "pending") return;
    for (const batch of this.head.batches.filter(row => row.staged > 0)) {
      const receipt = await this.artifacts.get<ReceiptData>(batch.receipt);
      await this.ack(
        batch.id,
        {
          ...receipt.result,
          outcomes: receipt.result.outcomes.map(row =>
            row.status === "staged" ? { operationId: row.operationId, status: "accepted" } : row
          ),
        },
        store,
        true,
        at
      );
    }
    const replacement = this.head.snapshot?.strategy === "native-replace";
    if (replacement) await this.snapshots.assertReplacementReady();
    await this.publish(
      replacement
        ? {
            ...this.head,
            snapshot: { ...this.head.snapshot!, replacementStatus: "accepted" },
          }
        : this.head,
      { phase: "finish_accepted" }
    );
    if (replacement) this.local.applyReplacement();
  }
  async finalPoint(sequence: number): Promise<ResumePoint> {
    const last = this.head.batches.find(row => row.last === sequence);
    if (last) {
      const batch = await this.loadBatch(last.id);
      return { sourceSequence: sequence, ...(batch.cursor ? { cursor: batch.cursor } : {}) };
    }
    const saved = await this.saved();
    return {
      sourceSequence: sequence,
      ...(this.scope.extraction === "cursor" && saved?.point.cursor ? { cursor: saved.point.cursor } : {}),
    };
  }
  async hasRejected() {
    return this.head.batches.some(row => row.rejected > 0);
  }
  /** Called after the complete initial upload pass, never for partial/uncertain extraction. */
  async detach() {
    const c = await this.current();
    if (c.detached) return;
    if (this.head.batches.some(b => b.status === "prepared" || b.status === "unknown" || b.rejected > 0)) return;
    if (this.scope.mode === "mirror") {
      const snapshot = this.head.snapshot;
      if (!snapshot?.sealed || !snapshot.summary) return;
      const planned =
        snapshot.strategy === "native-replace"
          ? snapshot.summary.uniqueMembers
          : snapshot.summary.newMembers + snapshot.summary.changedMembers + snapshot.summary.refreshMembers;
      const prepared = this.head.batches
        .filter(b => b.action === "upsert")
        .reduce((sum, b) => sum + b.last - b.first + 1, 0);
      if (prepared !== planned) return;
    } else if (!["batches_pending", "finish_pending"].includes(c.phase)) return;
    await this.publish(this.head, { detached: true });
  }
  async commitCheckpoint(point: ResumePoint, store: JsonObject, complete: boolean) {
    store = copy(store);
    const copied = copy({
        sourceSequence: point.sourceSequence,
        ...(point.cursor === undefined ? {} : { cursor: point.cursor }),
      }),
      c = await this.current(),
      n = copied.sourceSequence;
    if (copied.cursor)
      ensure(
        typeof copied.cursor.value === "string" &&
          Array.isArray(copied.cursor.primaryKeyValues) &&
          copied.cursor.primaryKeyValues.length > 0 &&
          copied.cursor.primaryKeyValues.length <= 8 &&
          copied.cursor.primaryKeyValues.every(value => typeof value === "string") &&
          Buffer.byteLength(canonicalJson(copied.cursor)) <= 65536,
        "Invalid checkpoint cursor"
      );
    ensure(
      Number.isSafeInteger(n) && n >= Number(c.checkpoint_sequence) && n <= Number(c.next_sequence),
      "Checkpoint is outside prepared prefix"
    );
    ensure(
      complete
        ? c.phase === "finish_accepted"
        : c.phase === "running" && this.scope.mode === "upsert" && this.scope.extraction === "cursor",
      "Checkpoint is not allowed in this phase"
    );
    if (complete)
      ensure(n === Number(c.finish_sequence) && n === Number(c.next_sequence), "Completion must cover all operations");
    const accepted = this.local.sql
      .prepare("SELECT count(*) AS n FROM operations WHERE sequence>? AND sequence<=? AND status='accepted'")
      .get(Number(c.base_sequence), n)!;
    ensure(Number(accepted.n) === n - Number(c.base_sequence), "Checkpoint crosses an unaccepted operation");
    const expected = await this.finalPoint(n);
    ensure(
      canonicalJson(copied.cursor ?? null) === canonicalJson(expected.cursor ?? null),
      "Checkpoint cursor does not match prepared boundary"
    );
    if (n > Number(c.base_sequence))
      ensure(
        this.head.batches.some(row => row.last === n),
        "Checkpoint must end at a batch boundary"
      );
    if (this.scope.mode === "mirror") await this.snapshots.assertPromotable();
    const generation = this.scope.mode === "mirror" ? this.scope.logicalRunId : c.committed_generation;
    await this.publish(
      this.head,
      {
        checkpoint_sequence: String(n),
        phase: complete ? "complete" : c.phase,
        committed_generation: generation,
        store: encodeJson(store),
      },
      { point: copied, store, ...(generation ? { generation } : {}) }
    );
  }
}
