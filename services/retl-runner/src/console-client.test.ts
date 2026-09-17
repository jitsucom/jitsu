import { afterEach, describe, it, expect, vi } from "vitest";
import { ReverseRunConfig } from "@jitsu/warehouse-query/src/runtime";
import { createConsoleClient, type ConsoleRequest } from "./console-client";
import { createAdapterRegistry } from "./adapters";

const config = ReverseRunConfig.parse({
  version: 1,
  kind: "reverse",
  id: "sync",
  workspaceId: "workspace",
  fromId: "model",
  toId: "dst",
  configRevision: "a".repeat(64),
  updatedAt: new Date().toISOString(),
  model: { warehouseId: "warehouse", query: "select email from users", primaryKey: ["email"] },
  warehouse: { destinationType: "postgres" },
  destination: {
    destinationType: "google-ads",
    authorized: true,
    oauthConnectionId: "destination.dst",
    customerId: "1234567890",
  },
  options: {
    stream: "audience",
    mode: "upsert",
    mapping: { email: "email" },
    streamOptions: { audienceId: "123", customerMatchTermsAccepted: true },
  },
});
afterEach(() => vi.useRealTimers());
describe("runner console OAuth and adapter binding", () => {
  it("binds admission and OAuth to sync/workspace/revision, never arbitrary connection IDs", async () => {
    const request = vi.fn<ConsoleRequest>(
      async url =>
        new Response(
          JSON.stringify(
            String(url).includes("reverse-sync-oauth")
              ? { accessToken: "token", expiresAt: new Date(Date.now() + 300000).toISOString() }
              : config
          )
        )
    );
    const client = createConsoleClient("https://console.test.local", "service-token", config, request);
    const signal = new AbortController().signal;
    expect(await client.admit(signal)).toEqual(config);
    expect(await client.accessToken(signal)).toBe("token");
    expect(request.mock.calls.map(([url]) => String(url))).toEqual([
      "https://console.test.local/api/admin/reverse-syncs/sync?workspaceId=workspace",
      `https://console.test.local/api/admin/reverse-sync-oauth/sync?workspaceId=workspace&configRevision=${config.configRevision}`,
    ]);
    for (const [, init] of request.mock.calls) {
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toEqual({ Authorization: "Bearer service-token" });
    }
  });
  it("caches briefly in memory, refreshes before expiry and does not cache errors", async () => {
    vi.useFakeTimers();
    const request = vi.fn<ConsoleRequest>(
      async () =>
        new Response(JSON.stringify({ accessToken: "token", expiresAt: new Date(Date.now() + 120000).toISOString() }))
    );
    const client = createConsoleClient("https://console.test.local", "service", config, request);
    const signal = new AbortController().signal;
    await client.accessToken(signal);
    await client.accessToken(signal);
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(91000);
    request.mockImplementationOnce(async () => new Response("private", { status: 403 }));
    await expect(client.accessToken(signal)).rejects.toThrow("denied or unavailable");
    expect(await client.accessToken(signal)).toBe("token");
    expect(request).toHaveBeenCalledTimes(3);
    await expect(client.accessToken(AbortSignal.abort())).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each([{ accessToken: "token", expiresAt: new Date(0).toISOString() }, { refreshToken: "private" }])(
    "rejects expired/malformed token responses",
    async value => {
      const client = createConsoleClient(
        "https://console.test.local",
        "service",
        config,
        async () => new Response(JSON.stringify(value))
      );
      await expect(client.accessToken(new AbortController().signal)).rejects.toThrow();
    }
  );
  it("registers only code-owned Google implementation, without fetching tokens during binding", () => {
    const token = vi.fn(async () => "token");
    const registry = createAdapterRegistry(token);
    expect([...registry.keys()]).toEqual(["google-ads"]);
    const adapter = registry.get("google-ads")!(config);
    expect(adapter.targetIdentity).toBe("google-data-manager:1234567890:123");
    expect(adapter.stream.batchDelivery).toBe("asynchronous");
    expect(adapter.mirror).toBeUndefined();
    expect(adapter.recovery?.({}).reconcileBatch).toBeTypeOf("function");
    expect(token).not.toHaveBeenCalled();
    expect(() => registry.get("google-ads")!({ ...config, toId: "other" })).toThrow("OAuth binding");
  });
});
