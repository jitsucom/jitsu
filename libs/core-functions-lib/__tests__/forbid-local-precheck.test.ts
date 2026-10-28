import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// JITSU-258: with FETCH_FORBID_LOCAL the destination of a fetch is checked before it is made. Under Deno there is no
// connect-time guard, so this check (and the redirect checks) is all there is. Deno is simulated by defining
// globalThis.Deno before the module loads, which makes makeFetch use the plain fetch with no dispatcher.

let server: http.Server;
let port: number;
let hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    res.end("SECRET");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise(resolve => server.close(resolve)));

async function loadMakeFetch() {
  vi.resetModules();
  vi.stubEnv("FETCH_FORBID_LOCAL", "true");
  vi.stubEnv("FETCH_LOCAL_WHITELIST", "");
  (globalThis as any).Deno = {};
  const { makeFetch } = await import("../src/functions/lib/index");
  return makeFetch("con", { log() {}, close() {}, deadLetter() {} } as any, "debug", 2000);
}

describe("FETCH_FORBID_LOCAL pre-check", () => {
  it.each([
    ["dotted loopback", () => `http://127.0.0.1:${port}/x`],
    ["IPv4-mapped loopback, dotted", () => `http://[::ffff:127.0.0.1]:${port}/x`],
    ["IPv4-mapped loopback, canonical hex form", () => `http://[::ffff:7f00:1]:${port}/x`],
  ])("refuses %s and never reaches the server", async (_, url) => {
    hits = [];
    try {
      const fetch = await loadMakeFetch();
      await expect(fetch(url())).rejects.toThrow(/fetch failed/);
      expect(hits).toEqual([]);
    } finally {
      delete (globalThis as any).Deno;
      vi.unstubAllEnvs();
    }
  });
});
