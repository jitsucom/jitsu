import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// JITSU-258: with FETCH_FORBID_LOCAL the destination of a fetch is checked before it is made, and again when the
// connection is opened, on every redirect hop too. That holds under Deno as well: Deno's native fetch takes no
// dispatcher, so with the guard on makeFetch uses undici's fetch with the guarded agent, as on Node. Deno is simulated
// by defining globalThis.Deno before the module loads.

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

async function loadMakeFetch(opts: { forbidLocal?: boolean; whitelist?: string } = {}) {
  vi.resetModules();
  vi.stubEnv("FETCH_FORBID_LOCAL", opts.forbidLocal === false ? "" : "true");
  vi.stubEnv("FETCH_LOCAL_WHITELIST", opts.whitelist ?? "");
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

const causeCode = (e: any) => e?.cause?.code ?? e?.code;

async function listenOn(handler: http.RequestListener): Promise<{ port: number; close: () => Promise<void> }> {
  const srv = http.createServer(handler);
  await new Promise<void>(resolve => srv.listen(0, "127.0.0.1", resolve));
  return {
    port: (srv.address() as AddressInfo).port,
    close: () => new Promise<void>(resolve => srv.close(() => resolve())),
  };
}

describe("FETCH_FORBID_LOCAL connect-time guard under Deno", () => {
  const nativeFetch = globalThis.fetch;
  const cleanup = () => {
    delete (globalThis as any).Deno;
    globalThis.fetch = nativeFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  };

  it("does not use Deno's native fetch while the guard is on, and does while it is off", async () => {
    const native = vi.fn(async () => new Response("native"));
    try {
      globalThis.fetch = native as any;
      hits = [];
      const guarded = await loadMakeFetch({ whitelist: "localhost" });
      const res = await guarded(`http://localhost:${port}/guarded`);
      expect(await res.text()).toBe("SECRET");
      expect(hits).toEqual(["/guarded"]);
      expect(native).not.toHaveBeenCalled();

      const unguarded = await loadMakeFetch({ forbidLocal: false });
      expect(await (await unguarded(`http://localhost:${port}/unguarded`)).text()).toBe("native");
      expect(native).toHaveBeenCalledOnce();
    } finally {
      cleanup();
    }
  });

  it("refuses a name whose DNS answer turns local after the pre-check, and never reaches the server", async () => {
    try {
      let lookups = 0;
      vi.spyOn(dns.promises, "lookup").mockImplementation((async () =>
        lookups++ === 0 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]) as any);
      hits = [];
      const fetch = await loadMakeFetch();
      const error = await fetch(`http://rebind.example:${port}/rebound`).catch(e => e);
      expect(causeCode(error)).toBe("EBLOCKED");
      expect(lookups).toBeGreaterThan(1); // the pre-check and the connection each resolved the name
      expect(hits).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("does not follow a redirect to an internal address", async () => {
    const internal = await listenOn((_, res) => ((hits.push("internal"), res.end("secret")), undefined));
    const redirector = await listenOn((_, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal.port}/metadata` });
      res.end();
    });
    try {
      hits = [];
      const fetch = await loadMakeFetch({ whitelist: "localhost" });
      const error = await fetch(`http://localhost:${redirector.port}/`).catch(e => e);
      expect(causeCode(error)).toBe("EBLOCKED");
      expect(hits).toEqual([]);
    } finally {
      cleanup();
      await internal.close();
      await redirector.close();
    }
  });

  it("keeps the caller's redirect policy and reports Response.redirected", async () => {
    const target = await listenOn((_, res) => res.end("final"));
    const redirector = await listenOn((_, res) => {
      res.writeHead(302, { location: `http://localhost:${target.port}/done` });
      res.end();
    });
    try {
      const fetch = await loadMakeFetch({ whitelist: "localhost" });
      const followed = await fetch(`http://localhost:${redirector.port}/`);
      expect(await followed.text()).toBe("final");
      expect(followed.redirected).toBe(true);
      expect(followed.url).toBe(`http://localhost:${target.port}/done`);

      const manual = await fetch(`http://localhost:${redirector.port}/`, { redirect: "manual" });
      expect(manual.status).toBe(302);
      expect(manual.redirected).toBe(false);

      await expect(fetch(`http://localhost:${redirector.port}/`, { redirect: "error" })).rejects.toThrow();
    } finally {
      cleanup();
      await target.close();
      await redirector.close();
    }
  });
});
