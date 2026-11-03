import { createClient } from "@clickhouse/client";
import { ClientRequest, createServer } from "node:http";
import { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

describe("ClickHouse streamed inserts", () => {
  it.each(["JSONCompactEachRow", "JSONEachRow"] as const)(
    "sends %s as UTF-8 buffers without stalling or changing rows",
    async format => {
      // Large enough to cross Node's HTTP high-water mark repeatedly. Non-ASCII
      // strings trigger nodejs/node#66781; ASCII-only payloads miss the regression.
      const rows = Array.from({ length: 4000 }, (_, i) => {
        const message = `Accrued payroll — café 中文 😀 ${i} ` + "ع".repeat(100);
        return format === "JSONCompactEachRow" ? [i, message] : { i, message };
      });
      const expected = Buffer.from(rows.map(row => JSON.stringify(row) + "\n").join(""));
      const chunks: Buffer[] = [];
      const server = createServer((req, res) => {
        req.on("data", chunk => chunks.push(chunk));
        req.on("end", () => {
          res.setHeader("X-ClickHouse-Query-Id", "buffer-regression");
          res.end();
        });
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const client = createClient({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        request_timeout: 2000,
      });
      // Observe the real SDK-to-HTTP boundary, not the received socket data:
      // Node always delivers received bytes as Buffers, even for string writes.
      const writes = vi.spyOn(ClientRequest.prototype, "write");
      try {
        const result = await client.insert({
          table: "events_log",
          format,
          values: Readable.from(rows),
        });
        expect(result.executed).toBe(true);
        expect(Buffer.concat(chunks).equals(expected)).toBe(true);
        expect(writes.mock.calls.length).toBeGreaterThan(0);
        expect(writes.mock.calls.every(([chunk]) => Buffer.isBuffer(chunk))).toBe(true);
      } finally {
        writes.mockRestore();
        await client.close();
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
      }
    },
    10000
  );
});
