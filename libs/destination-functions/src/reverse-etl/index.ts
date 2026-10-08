import type { ReverseEtlDestination, BuiltinReverseDestinationName } from "@jitsu/protocols/reverse-etl";
import { ReverseEtlProtocolError, validateStream } from "./meta";

export { runReverseEtl } from "./run";
export type { RunOptions, ReverseSourceRecord } from "./run";
export { recordKey, contentHash, createBufferedSyncStore } from "./identity";

/** Server-only registry, separate from the existing event-function registry. */
export function createReverseEtlRegistry(
  destinations: Record<BuiltinReverseDestinationName, ReverseEtlDestination<any>>
) {
  const registered = new Map<string, ReverseEtlDestination<any>>();
  for (const [name, destination] of Object.entries(destinations)) {
    if (!/^builtin\.reverse\.[a-z0-9-]+$/.test(name))
      throw new ReverseEtlProtocolError("Invalid reverse destination name");
    const names = destination.streams.map(stream => stream.name);
    if (new Set(names).size !== names.length || !names.includes(destination.defaultStream))
      throw new ReverseEtlProtocolError("Destination requires unique streams and a valid default stream");
    destination.streams.forEach(validateStream);
    registered.set(name, destination);
  }
  return { get: (name: string) => registered.get(name) };
}
