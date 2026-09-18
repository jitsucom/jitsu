import type { ObjectStore } from "./store";
import type { Client } from "pg";
import { gunzipSync } from "node:zlib";
import { decodeJson } from "../persistence/serialization";
import type { ArtifactRef } from "./store";
import type { ArtifactHead, StoredBatchData, ReceiptData } from "./state";
import type { Effect } from "../persistence/types";
import { LocalIndex, type Member } from "./local";

/** Test-only object service with immutable writes; never a production fallback. */
export class MemoryObjects implements ObjectStore {
  readonly objects = new Map<string, Buffer>();
  failPut = false;
  async put(key: string, value: Buffer, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.failPut) throw new Error("injected storage failure");
    if (this.objects.has(key) && !this.objects.get(key)!.equals(value)) throw new Error("collision");
    this.objects.set(key, Buffer.from(value));
  }
  async get(key: string, max: number, signal: AbortSignal) {
    signal.throwIfAborted();
    const value = this.objects.get(key);
    if (!value || value.length > max) throw new Error("missing/oversized");
    return Buffer.from(value);
  }
}

/** Inspect only published durable evidence, independently of a worker's scratch/cache. */
export async function persisted(client: Client, objects: MemoryObjects) {
  const control = (await client.query("SELECT artifact_head FROM newjitsu.reverse_sync_control")).rows[0];
  const read = <T>(ref: ArtifactRef): T => JSON.parse(gunzipSync(objects.objects.get(ref.key)!).toString()).value;
  const head = control?.artifact_head
    ? read<ArtifactHead>(decodeJson(control.artifact_head))
    : { version: 1 as const, runId: "", baseline: [], batches: [] };
  const local = await LocalIndex.create();
  try {
    for (const ref of head.baseline) local.restoreMembers(read<Member[]>(ref));
    const batches = head.batches.map(descriptor => {
      const data = read<StoredBatchData>(descriptor.data);
      const effects = data.effects
        ? read<Effect[][]>(data.effects)
        : data.batch.records.map(row => [row.row as Effect]);
      const receipt = descriptor.receipt ? read<ReceiptData>(descriptor.receipt) : undefined;
      return { descriptor, batch: data.batch, effects, receipt };
    });
    const operations = batches.flatMap(({ descriptor, batch, effects, receipt }) =>
      batch.records.map((record, i) => {
        const outcome = receipt?.result.outcomes.find(row => row.operationId === record.operationId)?.status;
        const status =
          outcome === "staged" && descriptor.status === "cancelled" ? "cancelled" : outcome ?? descriptor.status;
        const acceptedAt = receipt?.acceptedAt[record.operationId];
        if (status === "accepted")
          for (const effect of effects[i]) local.apply(effect, batch.action, record.sourceSequence, acceptedAt!);
        return { ...record, status, acceptedAt };
      })
    );
    return { head, batches, operations, members: [...local.memberPages()].flat() };
  } finally {
    await local.close();
  }
}
