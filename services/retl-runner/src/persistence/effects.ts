import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import { ensure, type Effect, type Identity } from "./types";

/** Only source snapshots may intentionally exclude a row; delivery operations require identities. */
export function effects(identities: Identity[], { allowEmpty = false }: { allowEmpty?: boolean } = {}): Effect[] {
  ensure(
    Array.isArray(identities) && (allowEmpty || identities.length > 0) && identities.length <= 100,
    "Invalid identity projection size"
  );
  const result = identities.map(value => {
    ensure(value && value.identity !== null && value.upsert && value.remove, "Invalid identity projection");
    return { ...value, identityHash: contentHash(value.identity), payloadHash: contentHash(value.upsert) };
  });
  ensure(new Set(result.map(value => value.identityHash)).size === result.length, "Duplicate projected identity");
  return result;
}
