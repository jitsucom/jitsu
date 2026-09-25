import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@jitsu/protocols/reverse-etl";
import type {
  DestinationServices,
  ReverseDestinationConfig,
  ScopedTargetState,
} from "@jitsu/protocols/reverse-etl-runtime";
import { createMetaRuntime } from "../src/functions/facebook/runtime";
import { resolveMetaAudience } from "../src/functions/facebook/provisioning";
import { contentHash } from "../src/reverse-etl/identity";
import { metaAudienceStateStream } from "../src/functions/facebook/reverse-meta";

const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function fixture() {
  const config: ReverseDestinationConfig = {
    id: "sync",
    workspaceId: "workspace",
    toId: "destination",
    destination: { accessToken: "token" },
    model: {},
    options: {
      stream: "audience",
      mode: "mirror",
      streamOptions: {
        accountId: "123",
        audience: { kind: "managed", name: "My audience" },
        exclusiveManagementConfirmed: true,
      },
    },
  };
  let value: JsonObject | undefined;
  const state: ScopedTargetState = {
    read: async () => value && structuredClone(value),
    create: async next => {
      if (!value) value = structuredClone(next);
    },
    compareAndSet: async (expected, next) => {
      if (!value || contentHash(value) !== contentHash(expected)) return false;
      value = structuredClone(next);
      return true;
    },
  };
  const remote = () => ({
    id: "456",
    account_id: "123",
    subtype: "CUSTOM",
    description: value!.marker,
    is_value_based: false,
  });
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") return response({ id: "456" });
    if (String(url).includes("/customaudiences")) return response({ data: [remote()] });
    return response(remote());
  });
  const log = vi.fn(async (_message: string) => {});
  const targetState = vi.fn((_key: string) => state);
  const services: DestinationServices = {
    fetch,
    signal: new AbortController().signal,
    log,
    targetState,
    getAccessToken: vi.fn(),
  };
  return {
    config,
    services,
    fetch,
    remote,
    targetState,
    state,
    saved: () => value,
    set: (next: JsonObject) => {
      value = next;
    },
  };
}
describe("Meta first-run provisioning and runtime binding", () => {
  it.each(["USER_PROVIDED_ONLY", "PARTNER_PROVIDED_ONLY", "BOTH_USER_AND_PARTNER_PROVIDED"])(
    "sends the provider customer-file source enum %s",
    async customerFileSource => {
      const f = fixture();
      f.config.options.streamOptions.customerFileSource = customerFileSource;
      await resolveMetaAudience(f.config, f.services);
      const create = f.fetch.mock.calls.find(([, options]) => options?.method === "POST")!;
      expect(JSON.parse(String(create[1]!.body)).customer_file_source).toBe(customerFileSource);
    }
  );
  it("persists creation intent before POST, reuses the ready audience, and exposes managed mirroring", async () => {
    const f = fixture();
    f.fetch.mockImplementation(async (url, init) => {
      if (init?.method === "POST") {
        expect(f.saved()).toMatchObject({ phase: "submitting", version: 1 });
        expect(JSON.parse(String(init.body))).toMatchObject({
          subtype: "CUSTOM",
          customer_file_source: "USER_PROVIDED_ONLY",
          description: f.saved()!.marker,
        });
        return response({ id: "456" });
      }
      return response(f.remote());
    });
    const adapter = await createMetaRuntime(f.config, f.services);
    expect(f.targetState).toHaveBeenCalledWith(metaAudienceStateStream);
    expect(f.saved()).toMatchObject({ phase: "ready", audienceId: "456" });
    expect(adapter.targetIdentity).toBe("meta-audience:123:456");
    expect(adapter.stream.capabilities.mirror).toBe("snapshot-diff");
    expect(await adapter.verifyMirrorBaseline!(f.services.signal)).toBe("tracked");
    const projected = adapter.mirror!.projection.rowType.parse({ email: "a@example.com" });
    const effect = adapter.mirror!.projection.project(projected)[0];
    expect(adapter.stream.rowType.parse(effect.upsert)).toEqual(effect.upsert);
    expect(adapter.stream.removeRowType!.parse(effect.remove)).toEqual(effect.remove);
    await createMetaRuntime(f.config, f.services);
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(f.services.getAccessToken).not.toHaveBeenCalled();
  });
  it("discovers a created audience after response loss without another POST", async () => {
    const f = fixture();
    f.fetch.mockImplementationOnce(async () => {
      throw new Error("socket closed after successful creation");
    });
    await expect(createMetaRuntime(f.config, f.services)).rejects.toThrow("verifiable response");
    expect(f.saved()?.phase).toBe("submitting");
    const adapter = await createMetaRuntime(f.config, f.services);
    expect(adapter.targetIdentity).toBe("meta-audience:123:456");
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("does not treat empty discovery as permission to create again", async () => {
    const f = fixture();
    f.fetch.mockRejectedValueOnce(new Error("timeout"));
    await expect(resolveMetaAudience(f.config, f.services)).rejects.toThrow();
    f.fetch.mockImplementation(async () => response({ data: [] }));
    await expect(resolveMetaAudience(f.config, f.services)).rejects.toThrow("retry discovery");
    await expect(resolveMetaAudience(f.config, f.services)).rejects.toThrow("retry discovery");
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("retries a definite rejected creation only after returning its saved intent to prepared", async () => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(response({ error: { code: 200, message: "Permissions" } }, 403));
    await expect(resolveMetaAudience(f.config, f.services)).rejects.toThrow("HTTP 403");
    expect(f.saved()?.phase).toBe("prepared");
    await resolveMetaAudience(f.config, f.services);
    expect(f.saved()?.phase).toBe("ready");
    expect(f.fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
  it("paginates with encoded cursors on the pinned host, never provider paging URLs", async () => {
    const f = fixture();
    f.fetch.mockRejectedValueOnce(new Error("timeout"));
    await expect(resolveMetaAudience(f.config, f.services)).rejects.toThrow();
    f.fetch.mockResolvedValueOnce(
      response({
        data: [],
        paging: { next: "https://evil.example/?access_token=secret", cursors: { after: "a&token=bad" } },
      })
    );
    await resolveMetaAudience(f.config, f.services);
    expect(f.fetch.mock.calls.some(([url]) => String(url).includes("evil.example"))).toBe(false);
    expect(f.fetch.mock.calls.some(([url]) => String(url).includes("after=a%26token%3Dbad"))).toBe(true);
  });
  it("rejects changed bindings, lost markers and duplicate discovery matches", async () => {
    const f = fixture();
    await resolveMetaAudience(f.config, f.services);
    await expect(resolveMetaAudience({ ...f.config, toId: "another" }, f.services)).rejects.toThrow("settings differ");
    f.fetch.mockResolvedValueOnce(response({ ...f.remote(), description: "changed" }));
    await expect(resolveMetaAudience(f.config, f.services)).rejects.toThrow("ownership marker");
    f.set({ ...f.saved()!, phase: "submitting" });
    f.fetch.mockResolvedValueOnce(response({ data: [f.remote(), { ...f.remote(), id: "457" }] }));
    await expect(resolveMetaAudience(f.config, f.services)).rejects.toThrow("unconfirmed");
  });
  it("verifies existing audiences without provisioning or OAuth", async () => {
    const f = fixture();
    f.config.options = {
      stream: "audience",
      mode: "upsert",
      streamOptions: { accountId: "act_123", audience: { kind: "existing", audienceId: "456" } },
    };
    f.fetch.mockResolvedValue(response({ id: "456", account_id: "123", subtype: "CUSTOM", is_value_based: false }));
    const adapter = await createMetaRuntime(f.config, f.services);
    expect(adapter.mirror).toBeUndefined();
    expect(f.targetState).not.toHaveBeenCalled();
    expect(f.fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    f.fetch.mockResolvedValue(response({ id: "456", account_id: "999", subtype: "CUSTOM" }));
    await expect(createMetaRuntime(f.config, f.services)).rejects.toThrow("does not match");
  });
  it("conversions never provision audiences, and unknown streams fail before I/O", async () => {
    const f = fixture();
    const adapter = await createMetaRuntime(
      { ...f.config, options: { stream: "conversions", mode: "upsert", streamOptions: { pixelId: "789" } } },
      f.services
    );
    expect(adapter.insertOnly).toBe(true);
    expect(adapter.mirror).toBeUndefined();
    expect(f.fetch).not.toHaveBeenCalled();
    await expect(
      createMetaRuntime({ ...f.config, options: { ...f.config.options, stream: "typo" } }, f.services)
    ).rejects.toThrow("Unsupported");
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
