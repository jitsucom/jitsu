import { describe, expect, it, vi } from "vitest";
import type { DestinationServices, ReverseDestinationConfig } from "@jitsu/protocols/reverse-etl-runtime";
import type { JsonObject } from "@jitsu/protocols/reverse-etl";
import { resolveGoogleAudience } from "../src/functions/google-ads/audience/provisioning";

function fixture() {
  let state: JsonObject | undefined;
  let remote: any;
  const config: ReverseDestinationConfig = {
    id: "sync",
    workspaceId: "ws",
    toId: "dst",
    model: {},
    destination: { customerId: "1234567890", authorized: true, oauthConnectionId: "destination.dst" },
    options: {
      stream: "audience",
      mode: "mirror",
      streamOptions: {
        audience: { kind: "managed", displayName: "My audience" },
        customerMatchTermsAccepted: true,
        exclusiveManagementConfirmed: true,
      },
    },
  };
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === "POST") {
      expect(state?.phase).toBe("submitting");
      remote = {
        ...JSON.parse(String(init.body)),
        id: "123",
        name: "accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/123",
        accessReason: "OWNED",
      };
      return Response.json(remote);
    }
    return Response.json(String(url).includes("?") ? { userLists: remote ? [remote] : [] } : remote);
  });
  const services: DestinationServices = {
    signal: new AbortController().signal,
    getAccessToken: vi.fn(async () => "token"),
    fetch: request,
    log: vi.fn(async () => {}),
    targetState: key => {
      expect(key).toBe("_REVERSE_ETL_GOOGLE_AUDIENCE_");
      return {
        read: async () => structuredClone(state),
        create: async value => {
          state ??= structuredClone(value);
        },
        compareAndSet: async (expected, value) => {
          if (JSON.stringify(state) !== JSON.stringify(expected)) return false;
          state = structuredClone(value);
          return true;
        },
      };
    },
  };
  return { config, services, request, state: () => state };
}
describe("provider provisioning with host-scoped state", () => {
  it("persists the same ready state and reuses it after restart", async () => {
    const f = fixture();
    const resolved = await resolveGoogleAudience(f.config, f.services);
    expect(f.state()).toMatchObject({
      version: 1,
      workspaceId: "ws",
      phase: "ready",
      audienceId: "123",
      managed: { syncId: "sync", customerId: "1234567890", membershipDays: 540 },
    });
    expect(resolved.options.streamOptions).toMatchObject({
      audienceId: "123",
      managedAudienceId: f.state()!.managed && (f.state()!.managed as JsonObject).id,
    });
    expect(resolved.options.streamOptions).not.toHaveProperty("audience");
    const saved = structuredClone(f.state());
    expect(await resolveGoogleAudience(f.config, f.services)).toEqual(resolved);
    expect(f.state()).toEqual(saved);
    expect(f.request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(f.config.options.streamOptions).toHaveProperty("audience");
  });

  it("discovers an uncertain create without resubmitting it", async () => {
    const f = fixture();
    const fetch = f.services.fetch;
    let once = true;
    f.services.fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (once && init?.method === "POST") {
        once = false;
        throw new Error("lost response");
      }
      return response;
    };
    await expect(resolveGoogleAudience(f.config, f.services)).rejects.toThrow("preserve creation evidence");
    expect(f.state()?.phase).toBe("submitting");
    await resolveGoogleAudience(f.config, f.services);
    expect(f.state()?.phase).toBe("ready");
    expect(f.request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("does not claim submission when OAuth fails", async () => {
    const f = fixture();
    f.services.getAccessToken = async () => {
      throw new Error("unavailable");
    };
    await expect(resolveGoogleAudience(f.config, f.services)).rejects.toThrow("unavailable");
    expect(f.state()?.phase).toBe("prepared");
    expect(f.request).not.toHaveBeenCalled();
  });
});
