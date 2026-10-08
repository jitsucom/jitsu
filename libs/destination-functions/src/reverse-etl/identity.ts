import { createHash } from "node:crypto";
import type { Json, JsonObject, BufferedSyncStore } from "@jitsu/protocols/reverse-etl";
import { ReverseEtlProtocolError } from "./meta";

/** Stable JSON; reject values JSON.stringify would silently drop or coerce. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new ReverseEtlProtocolError("Reverse ETL payloads must be lossless JSON values");
}
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function recordKey(values: Array<string | number | boolean>): string {
  if (
    !values.length ||
    values.some(
      v =>
        !["string", "number", "boolean"].includes(typeof v) ||
        (typeof v === "number" && (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))))
    )
  ) {
    throw new ReverseEtlProtocolError("Primary keys require non-null lossless scalar values");
  }
  return contentHash(values.map(value => [typeof value, value]));
}
export function createBufferedSyncStore(initial: JsonObject = {}, maxBytes = 65536): BufferedSyncStore {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536)
    throw new ReverseEtlProtocolError("Invalid provider state byte limit");
  let state = JSON.parse(canonicalJson(initial)) as JsonObject;
  const copy = (value: Json) => JSON.parse(canonicalJson(value));
  const check = (next: JsonObject) => {
    if (Buffer.byteLength(canonicalJson(next)) > maxBytes)
      throw new ReverseEtlProtocolError("Provider state exceeds its byte limit");
  };
  check(state);
  return {
    get: key => (Object.hasOwn(state, key) ? copy(state[key]) : undefined),
    set(key, value) {
      const next = { ...state, [key]: copy(value) };
      check(next);
      state = next;
    },
    delete(key) {
      delete state[key];
    },
    snapshot: () => copy(state),
  };
}
