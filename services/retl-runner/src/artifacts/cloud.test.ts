import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { Readable, Writable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import type { Storage } from "@google-cloud/storage";
import { s3Objects, gcsObjects } from "./cloud";
import { objectStorageFromEnv } from "./config";

describe("S3 transport", () => {
  let server: Server, client: S3Client;
  const files = new Map<string, Buffer>();
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const key = req.url!.split("?")[0];
      if (req.method === "PUT") {
        expect(req.headers["if-none-match"]).toBe("*");
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        if (files.has(key)) {
          res
            .writeHead(412, { "content-type": "application/xml" })
            .end("<Error><Code>PreconditionFailed</Code></Error>");
          return;
        }
        files.set(key, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"test"' }).end();
      } else if (req.method === "GET") {
        const value = files.get(key);
        if (!value) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { "content-length": value.length, "content-type": "application/octet-stream" }).end(value);
      } else res.writeHead(405).end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    client = new S3Client({
      endpoint: `http://127.0.0.1:${address.port}`,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      maxAttempts: 1,
    });
  });
  afterAll(async () => {
    client.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  it("uses conditional immutable writes, verifies collisions and bounds streamed downloads", async () => {
    const store = s3Objects("test-bucket", "prefix/", client),
      signal = new AbortController().signal;
    const data = Buffer.from("test payload");
    await store.put("object", data, signal);
    await store.put("object", data, signal);
    expect(await store.get("object", data.length, signal)).toEqual(data);
    await expect(store.put("object", Buffer.from("different"), signal)).rejects.toThrow();
    await expect(store.get("object", 1, signal)).rejects.toThrow("byte limit");
    await expect(store.get("object", 100, AbortSignal.abort())).rejects.toThrow();
  });
});
describe("GCS transport", () => {
  it("requires generation preconditions and verifies existing objects", async () => {
    const files = new Map<string, Buffer>();
    const fake = {
      bucket: () => ({
        file: (key: string) => ({
          createWriteStream: (options: any) => {
            expect(options).toMatchObject({ resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
            return new Writable({
              write(chunk, _encoding, callback) {
                if (files.has(key)) callback(Object.assign(new Error("exists"), { code: 412 }));
                else {
                  files.set(key, Buffer.from(chunk));
                  callback();
                }
              },
            });
          },
          createReadStream: () => Readable.from([files.get(key)!]),
        }),
      }),
    } as unknown as Storage;
    const store = gcsObjects("bucket", "prefix/", fake),
      signal = new AbortController().signal,
      data = Buffer.from("payload");
    await store.put("object", data, signal);
    await store.put("object", data, signal);
    expect(await store.get("object", data.length, signal)).toEqual(data);
    await expect(store.put("object", Buffer.from("changed"), signal)).rejects.toThrow("collision");
    await expect(store.get("object", 1, signal)).rejects.toThrow("byte limit");
  });
  it("cancels a stalled download even while verifying a pre-existing upload", async () => {
    const fake = {
      bucket: () => ({
        file: () => ({
          createWriteStream: () =>
            new Writable({
              write(_chunk, _encoding, callback) {
                callback(Object.assign(new Error("exists"), { code: 412 }));
              },
            }),
          createReadStream: () => new Readable({ read() {} }),
        }),
      }),
    } as unknown as Storage;
    const store = gcsObjects("bucket", "prefix/", fake),
      controller = new AbortController();
    const pending = store.put("object", Buffer.from("data"), controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow("cancelled");
  });
});
it("requires explicit, deployment-owned storage configuration", () => {
  const signal = new AbortController().signal;
  expect(() => objectStorageFromEnv({}, signal)).toThrow("RETL_OBJECT_STORE is required");
  expect(() => objectStorageFromEnv({ RETL_OBJECT_BUCKET: "bucket" }, signal)).toThrow("required");
  expect(() => objectStorageFromEnv({ RETL_OBJECT_STORE: "gcs" }, signal)).toThrow("required");
  expect(() =>
    objectStorageFromEnv({ RETL_OBJECT_STORE: "gcs", RETL_OBJECT_BUCKET: "https://untrusted" }, signal)
  ).toThrow();
  expect(() =>
    objectStorageFromEnv({ RETL_OBJECT_STORE: "gcs", RETL_OBJECT_BUCKET: "bucket", RETL_OBJECT_PREFIX: "../" }, signal)
  ).toThrow();
});
