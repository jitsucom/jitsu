import { canonicalJson } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { ensure, PersistenceError } from "./types";

const envelopeBytes = Buffer.byteLength('{"version":1,"value":}');

/** Exact storage size for a canonical JSON payload in the versioned bytea format. */
export function jsonByteBudget(payloadBytes: number): number {
  return payloadBytes + envelopeBytes;
}

/** Plain UTF-8 JSON; the existing bytea columns require no schema migration. */
export function encodeJson(value: unknown, maxBytes = 65536): Buffer {
  const payload = canonicalJson(value);
  ensure(Buffer.byteLength(payload) <= maxBytes, "Persisted value exceeds its byte budget");
  return Buffer.from(`{"version":1,"value":${payload}}`);
}

export function decodeJson<T>(value: Buffer): T {
  try {
    const envelope = JSON.parse(value.toString("utf8"));
    ensure(envelope?.version === 1 && Object.hasOwn(envelope, "value"), "Unsupported persistence format");
    return envelope.value;
  } catch {
    // Never include the payload or JSON parser diagnostics in logs.
    throw new PersistenceError("Recovery data could not be decoded; unsupported or invalid persistence format");
  }
}
