import { afterEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import { AddressInfo } from "node:net";
import { fetch } from "undici";
import { createGuardedAgent, normalizeHostname } from "../src/functions/lib/guarded-agent";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve))));
});

async function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

const causeCode = (e: any) => e?.cause?.code ?? e?.code;

describe("createGuardedAgent", () => {
  it("refuses an IP literal that is not public", async () => {
    let hit = false;
    const port = await listen((_, res) => ((hit = true), res.end("secret")));
    const error = await fetch(`http://127.0.0.1:${port}/`, { dispatcher: createGuardedAgent() }).catch(e => e);
    expect(causeCode(error)).toBe("EBLOCKED");
    expect(hit).toBe(false);
  });

  it("refuses a hostname that resolves to a non-public address, at connect time", async () => {
    let hit = false;
    const port = await listen((_, res) => ((hit = true), res.end("secret")));
    const agent = createGuardedAgent({ resolve: async () => [{ address: "127.0.0.1", family: 4 }] });
    const error = await fetch(`http://rebinding.example:${port}/`, { dispatcher: agent }).catch(e => e);
    expect(causeCode(error)).toBe("EBLOCKED");
    expect(hit).toBe(false);
  });

  it("refuses a hostname when any of its answers is non-public", async () => {
    const agent = createGuardedAgent({
      resolve: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
    });
    const error = await fetch(`http://mixed.example:81/`, { dispatcher: agent }).catch(e => e);
    expect(causeCode(error)).toBe("EBLOCKED");
  });

  it("does not follow a redirect to an internal address", async () => {
    let internalHit = false;
    const internal = await listen((_, res) => ((internalHit = true), res.end("secret")));
    const redirector = await listen((_, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal}/metadata` });
      res.end();
    });
    // localhost is the one host allowed to be local, so the first hop works and the redirect target is what gets refused
    const agent = createGuardedAgent({ allowedHosts: ["localhost"] });
    const error = await fetch(`http://localhost:${redirector}/`, { dispatcher: agent }).catch(e => e);
    expect(causeCode(error)).toBe("EBLOCKED");
    expect(internalHit).toBe(false);
  });

  it("lets an allowed host reach a local address", async () => {
    const port = await listen((_, res) => res.end("ok"));
    const agent = createGuardedAgent({ allowedHosts: ["localhost"] });
    const res = await fetch(`http://localhost:${port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("ok");
  });

  it("reaches a public address (stubbed to the local server)", async () => {
    const port = await listen((_, res) => res.end("ok"));
    const agent = createGuardedAgent({
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      isBlocked: () => false,
    });
    const res = await fetch(`http://public.example:${port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("ok");
  });
});

describe("IPv6 whitelist entries", () => {
  it("normalizes brackets and case, so `[::1]` and `::1` are the same entry", () => {
    expect(normalizeHostname("[::1]")).toBe("::1");
    expect(normalizeHostname(" [FD00::A] ")).toBe("fd00::a");
    expect(normalizeHostname("LocalHost")).toBe("localhost");
  });

  it.each(["[::1]", "::1"])(
    "lets a whitelisted IPv6 loopback literal (%s) through and refuses it otherwise",
    async entry => {
      const server = http.createServer((_, res) => res.end("ok"));
      servers.push(server);
      const listening = await new Promise<boolean>(resolve => {
        server.once("error", () => resolve(false));
        server.listen(0, "::1", () => resolve(true));
      });
      if (!listening) return; // no IPv6 loopback on this machine
      const port = (server.address() as AddressInfo).port;
      const allowed = await fetch(`http://[::1]:${port}/`, {
        dispatcher: createGuardedAgent({ allowedHosts: [entry] }),
      });
      expect(await allowed.text()).toBe("ok");
      const refused = await fetch(`http://[::1]:${port}/`, { dispatcher: createGuardedAgent() }).catch(e => e);
      expect(causeCode(refused)).toBe("EBLOCKED");
    }
  );
});
