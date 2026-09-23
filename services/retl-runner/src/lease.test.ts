import { describe, it, expect, vi } from "vitest";
import { KubernetesLease, reverseResourceName, type LeaseRequest } from "./lease";

function api() {
  let value: any;
  let version = 0;
  const calls: string[] = [];
  const call: LeaseRequest = async (method, _path, input: any) => {
    calls.push(method);
    const response = (status: number) => ({ status, body: value ? structuredClone(value) : ({} as any) });
    if (method === "GET") return response(value ? 200 : 404);
    if (method === "POST" && value) return response(409);
    if (method === "PUT" && input.metadata.resourceVersion !== value?.metadata.resourceVersion) return response(409);
    if (method === "DELETE") {
      if (
        input.preconditions.resourceVersion !== value?.metadata.resourceVersion ||
        input.preconditions.uid !== value?.metadata.uid
      )
        return response(409);
      value = undefined;
      return response(200);
    }
    value = structuredClone(input);
    value.metadata.resourceVersion = String(++version);
    value.metadata.uid = "uid";
    return response(method === "POST" ? 201 : 200);
  };
  return {
    call,
    calls,
    expire: () => {
      value.spec.renewTime = new Date(0).toISOString();
    },
    value: () => value,
  };
}
describe("Kubernetes lease", () => {
  it("serializes acquisition and renewal timestamps as Kubernetes MicroTime", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-17T14:21:51.030Z"));
      const a = api();
      const lease = new KubernetesLease(a.call, "default", "sync", "one");
      await lease.acquire();
      expect(a.value().spec.renewTime).toBe("2026-09-17T14:21:51.030000Z");
      vi.setSystemTime(new Date("2026-09-17T14:22:01.123Z"));
      await lease.renew();
      expect(a.value().spec.renewTime).toBe("2026-09-17T14:22:01.123000Z");
    } finally {
      vi.useRealTimers();
    }
  });
  it("uses Kubernetes MicroTime precision for creation, renewal and takeover", async () => {
    const a = api();
    const timestamps: string[] = [];
    const call: LeaseRequest = async (method, path, body: any) => {
      if (method === "POST" || method === "PUT") {
        const timestamp = body.spec.renewTime;
        if (!/\.\d{6}Z$/.test(timestamp)) return { status: 400, body: {} as any };
        timestamps.push(timestamp);
      }
      return a.call(method, path, body);
    };
    const first = new KubernetesLease(call, "default", "sync", "one");
    await first.acquire();
    await first.renew();
    a.expire();
    await new KubernetesLease(call, "default", "sync", "two").acquire();
    expect(timestamps).toHaveLength(3);
    for (const timestamp of timestamps) expect(Number.isFinite(Date.parse(timestamp))).toBe(true);
  });
  it("uses case-preserving deterministic names shared with syncctl", () => {
    expect(reverseResourceName("sync")).toBe("reverse-75c75efe327a8ef35a072f25117961f5");
    expect(reverseResourceName("Sync")).not.toBe(reverseResourceName("sync"));
  });
  it("CAS admits only one concurrent owner", async () => {
    const a = api();
    const results = await Promise.allSettled([
      new KubernetesLease(a.call, "default", "sync", "one").acquire(),
      new KubernetesLease(a.call, "default", "sync", "two").acquire(),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("renews and releases only its live epoch", async () => {
    const a = api(),
      first = new KubernetesLease(a.call, "default", "sync", "one"),
      next = new KubernetesLease(a.call, "default", "sync", "two");
    await first.acquire();
    await first.renew();
    await expect(next.acquire()).rejects.toThrow();
    a.expire();
    await next.acquire();
    await expect(first.renew()).rejects.toThrow();
    await first.release();
    expect(a.value().spec.holderIdentity).toBe("two");
    await next.release();
    expect(a.value()).toBeUndefined();
  });
  it("cannot resurrect an expired lease even without a new owner", async () => {
    const a = api(),
      lease = new KubernetesLease(a.call, "default", "sync", "one");
    await lease.acquire();
    a.expire();
    await expect(lease.renew()).rejects.toThrow();
  });
  it("fails closed on unavailable API", async () => {
    const lease = new KubernetesLease(async () => ({ status: 503, body: {} as any }), "default", "sync", "one");
    await expect(lease.acquire()).rejects.toThrow();
  });
});
