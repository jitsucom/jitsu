import { afterEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import { AddressInfo } from "node:net";
import { createGuardedFetch } from "@jitsu/core-functions-lib";
import { sendOtlpTestRequest } from "../../lib/server/otlp-test-request";

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

const payload = new Uint8Array([1, 2, 3]);
const headers = [{ name: "X-Test", value: "1" }];

describe("OTLP test request", () => {
  it("does not call an internal address, and says why", async () => {
    let hit = false;
    const port = await listen((_, res) => ((hit = true), res.end("secret")));
    let failure: unknown;
    const result = await sendOtlpTestRequest({ endpoint: `http://127.0.0.1:${port}/v1/logs`, headers }, payload, {
      onFailure: e => (failure = e),
    });
    expect(hit).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.response).toBeUndefined();
    expect(result.error).toMatch(/private or internal address/);
    expect(failure).toBeDefined();
  });

  it("does not follow a redirect to an internal address", async () => {
    let internalHit = false;
    const internal = await listen((_, res) => ((internalHit = true), res.end("secret")));
    const redirector = await listen((_, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal}/metadata` });
      res.end();
    });
    const result = await sendOtlpTestRequest({ endpoint: `http://localhost:${redirector}/v1/logs`, headers }, payload, {
      fetch: createGuardedFetch({ allowedHosts: ["localhost"] }),
    });
    expect(internalHit).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private or internal address/);
  });

  it("reaches an allowed host and returns the status and a capped preview of the answer", async () => {
    let received = "";
    const port = await listen((req, res) => {
      received = `${req.method} ${req.headers["content-type"]} ${req.headers["x-test"]}`;
      res.end("x".repeat(5000));
    });
    const result = await sendOtlpTestRequest({ endpoint: `http://localhost:${port}/v1/logs`, headers }, payload, {
      fetch: createGuardedFetch({ allowedHosts: ["localhost"] }),
    });
    expect(received).toBe("POST application/x-protobuf 1");
    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(result.response).toHaveLength(1000);
  });

  it("reports a connection failure as the plain error", async () => {
    const port = await listen((_, res) => res.end());
    await new Promise(resolve => servers.pop()!.close(resolve));
    const result = await sendOtlpTestRequest({ endpoint: `http://localhost:${port}/v1/logs`, headers }, payload, {
      fetch: createGuardedFetch({ allowedHosts: ["localhost"] }),
    });
    expect(result.ok).toBe(false);
    expect(result.error).not.toMatch(/private or internal address/);
  });
});
