import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn(async (..._args: any[]) => ({ bucket: "x" })) }));
vi.mock("juava", async importOriginal => ({ ...(await importOriginal<typeof import("juava")>()), rpc }));

import {
  isWebhookDestination,
  provisionRetlBucketForSync,
  provisionRetlBucketViaEe,
  retentionConfig,
  retlBucketName,
} from "../../lib/server/reverse-retention";

beforeEach(() => rpc.mockClear());
afterEach(() => vi.unstubAllEnvs());
const withEe = () => {
  vi.stubEnv("EE_CONNECTION", "https://billing.example.com/");
  vi.stubEnv("EE_API_SERVICE_TOKEN", "test-token");
};

const prismaWith = (link: unknown) => ({ configurationObjectLink: { findFirst: vi.fn(async () => link) } } as any);

describe("retention helpers (JITSU-242)", () => {
  it("names the bucket like ee-api does", () => {
    expect(retlBucketName("ws1")).toBe("jitsu-retl-ws1");
  });

  it("only a webhook destination counts", () => {
    expect(isWebhookDestination({ destinationType: "webhook" })).toBe(true);
    for (const type of ["google-ads", "postgres", "", undefined]) {
      expect(isWebhookDestination({ destinationType: type })).toBe(false);
    }
  });

  it("retention config: webhook with ee-api only", () => {
    expect(retentionConfig("ws1", { destinationType: "webhook" })).toBeUndefined(); // no ee-api
    withEe();
    expect(retentionConfig("ws1", { destinationType: "webhook" })).toEqual({ bucket: "jitsu-retl-ws1" });
    expect(retentionConfig("ws1", { destinationType: "google-ads" })).toBeUndefined();
  });

  it("provisioning calls retl-init with the workspace id, and not at all without ee-api", async () => {
    await provisionRetlBucketViaEe("ws 1");
    expect(rpc).not.toHaveBeenCalled();
    withEe();
    await provisionRetlBucketViaEe("ws 1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(String(rpc.mock.calls[0][0])).toBe("https://billing.example.com/api/retl-init?workspaceId=ws%201");
  });

  it("a failing ee-api call is swallowed", async () => {
    withEe();
    rpc.mockRejectedValueOnce(new Error("down"));
    await expect(provisionRetlBucketViaEe("ws1")).resolves.toBeUndefined();
  });

  it("after a sync is saved: provisions for a webhook destination only, and never throws", async () => {
    withEe();
    await provisionRetlBucketForSync(prismaWith({ to: { config: { destinationType: "webhook" } } }), "ws1", "s1");
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockClear();
    await provisionRetlBucketForSync(prismaWith({ to: { config: { destinationType: "google-ads" } } }), "ws1", "s1");
    await provisionRetlBucketForSync(prismaWith(null), "ws1", "s1");
    expect(rpc).not.toHaveBeenCalled();
    const broken = { configurationObjectLink: { findFirst: async () => Promise.reject(new Error("db")) } } as any;
    await expect(provisionRetlBucketForSync(broken, "ws1", "s1")).resolves.toBeUndefined();
  });
});
