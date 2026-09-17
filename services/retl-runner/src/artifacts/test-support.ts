import type { ObjectStore } from "./store";

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
