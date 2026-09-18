import { Storage } from "@google-cloud/storage";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { ObjectStore } from "./store";
import { ensure } from "../persistence/types";

async function collect(source: AsyncIterable<Uint8Array>, maxBytes: number, signal: AbortSignal) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of source) {
    signal.throwIfAborted();
    size += chunk.length;
    ensure(size <= maxBytes, "Object exceeds declared byte limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Uses Application Default Credentials / Workload Identity; never destination OAuth. */
export function gcsObjects(bucket: string, prefix = "reverse-etl/", storage = new Storage()): ObjectStore {
  const file = (key: string) => storage.bucket(bucket).file(prefix + key);
  const get = async (key: string, maxBytes: number, signal: AbortSignal) => {
    signal.throwIfAborted();
    const stream = file(key).createReadStream();
    const abort = () => stream.destroy(new Error("Artifact download cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await collect(stream, maxBytes, signal);
    } finally {
      signal.removeEventListener("abort", abort);
      stream.destroy();
    }
  };
  return {
    get,
    async put(key, data, signal) {
      signal.throwIfAborted();
      const stream = file(key).createWriteStream({ resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
      const abort = () => stream.destroy(new Error("Artifact upload cancelled"));
      signal.addEventListener("abort", abort, { once: true });
      try {
        await new Promise<void>((resolve, reject) => {
          stream.once("finish", resolve).once("error", reject).end(data);
        });
      } catch (error) {
        // Existing content-addressed objects are verified, never blindly trusted.
        if ((error as { code?: number }).code !== 412) throw error;
        const existing = await get(key, data.length, signal);
        ensure(existing.equals(data), "Immutable object collision");
      } finally {
        signal.removeEventListener("abort", abort);
      }
    },
  };
}

/** S3-compatible storage must support conditional PutObject; no unsafe fallback. */
export function s3Objects(bucket: string, prefix = "reverse-etl/", client = new S3Client({})): ObjectStore {
  const get = async (key: string, maxBytes: number, signal: AbortSignal) => {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: prefix + key }), {
      abortSignal: signal,
    });
    ensure(response.Body, "Missing object body");
    const stream = response.Body as AsyncIterable<Uint8Array> & { destroy(): void };
    try {
      return await collect(stream, maxBytes, signal);
    } finally {
      stream.destroy();
    }
  };
  return {
    get,
    async put(key, data, signal) {
      try {
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: prefix + key, Body: data, IfNoneMatch: "*" }), {
          abortSignal: signal,
        });
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 412) throw error;
        ensure((await get(key, data.length, signal)).equals(data), "Immutable object collision");
      }
    },
  };
}
