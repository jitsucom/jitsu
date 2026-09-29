import { createReadStream } from "node:fs";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { addAbortSignal } from "node:stream";

export const streamSpoolBytes = 512 * 1024 * 1024;

/** Drain one query to bounded private scratch storage before yielding to a slow consumer.
 * Never re-query pages: doing so could mix different warehouse snapshots.
 * The runner mounts ephemeral /tmp; this file is not durable recovery state.
 */
export async function* spoolJsonRows<T>(
  source: AsyncIterable<string>,
  signal?: AbortSignal,
  options: { maxBytes?: number; directory?: string } = {}
): AsyncIterable<T> {
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(options.directory ?? tmpdir(), "jitsu-warehouse-"));
  const path = join(directory, "rows.jsonl");
  try {
    const file = await open(path, "wx", 0o600);
    try {
      let bytes = 0;
      let buffer = "";
      for await (const row of source) {
        signal?.throwIfAborted();
        const line = row + "\n";
        bytes += Buffer.byteLength(line);
        if (bytes > (options.maxBytes ?? streamSpoolBytes))
          throw new Error(
            "Warehouse extraction exceeds the 512 MiB temporary-file budget; select fewer columns or split the model"
          );
        buffer += line;
        if (buffer.length >= 64 * 1024) {
          await file.writeFile(buffer);
          buffer = "";
        }
      }
      if (buffer) await file.writeFile(buffer);
    } finally {
      await file.close();
    }
    signal?.throwIfAborted();
    const stream = createReadStream(path);
    if (signal) addAbortSignal(signal, stream);
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    // readline does not forward input errors to its async iterator.
    let readError: Error | undefined;
    stream.on("error", error => {
      readError = error;
      lines.close();
    });
    try {
      for await (const line of lines) {
        signal?.throwIfAborted();
        yield JSON.parse(line) as T;
      }
      signal?.throwIfAborted();
      if (readError) throw readError;
    } finally {
      lines.close();
      stream.destroy();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
