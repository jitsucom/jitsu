import { describe, expect, it, vi } from "vitest";
import { requestReverseController } from "../../lib/server/reverse-controller";

const input = {
  baseUrl: "http://localhost:3043/",
  token: "private-token",
  action: "run" as const,
  query: { kind: "reverse", syncId: "sync", workspaceId: "workspace", updatedAt: "2026-10-13T13:38:57.754Z" },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("Reverse ETL controller diagnostics", () => {
  it.each(["run", "refresh", "cancel"] as const)("preserves %s requests without retrying", async action => {
    const taskId = "reverse-cron-job-123-abc";
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true, taskId }));
    await expect(requestReverseController({ ...input, action }, request)).resolves.toEqual({ ok: true, taskId });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe(action === "cancel" ? "/cancel" : "/read");
    expect(new URL(String(url)).searchParams.get("updatedAt")).toBe(input.query.updatedAt);
    expect(options).toMatchObject({
      method: action === "cancel" ? "GET" : "POST",
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: "Bearer private-token" },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["ECONNREFUSED", "Connection refused"],
    ["ENOTFOUND", "hostname could not be resolved"],
    ["SELF_SIGNED_CERT_IN_CHAIN", "TLS certificate could not be verified"],
    ["ECONNRESET", "was interrupted"],
    ["UND_ERR_CONNECT_TIMEOUT", "timed out"],
  ])("explains %s without exposing raw error data", async (code, message) => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(
      new TypeError("private-token", {
        cause: new AggregateError([Object.assign(new Error("private-payload"), { code })]),
      })
    );
    const error = await requestReverseController(input, request).catch(e => e);
    expect(error).toMatchObject({ status: 503 });
    expect(error.message).toContain(message);
    expect(error.message).toContain("port-forward");
    expect(error.message).toContain("Check attempts before retrying");
    expect(error.message).not.toMatch(/private-token|private-payload/);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not suggest a local tunnel for a remote controller", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("private", "TimeoutError"));
    const error = await requestReverseController({ ...input, baseUrl: "https://syncctl.example.com" }, request).catch(
      e => e
    );
    expect(error.message).toContain("timed out");
    expect(error.message).not.toContain("port-forward");
  });

  it.each([401, 403])("explains HTTP %s authentication failures", async status => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-token", { status }));
    const error = await requestReverseController(input, request).catch(e => e);
    expect(error.message).toContain("SYNCCTL_AUTH_KEY");
    expect(error.message).not.toContain("private-token");
  });

  it.each([
    [409, "Reverse configuration is unavailable or stale", "current configuration"],
    [503, "Reverse runner is disabled", "disabled in syncctl"],
    [503, "Reverse job creation rejected", "Kubernetes rejected"],
    [503, "Reverse job creation uncertain", "Check attempts before retrying"],
    [503, "Status refresh queued; automatic scheduling will retry", "retry automatically"],
  ])("preserves safe controller diagnostics: %s %s", async (status, reason, expected) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: false, error: reason }, status));
    const error = await requestReverseController(input, request).catch(e => e);
    expect(error.message).toContain(expected);
    expect(error.status).toBe(status);
  });

  it.each([
    json({ ok: false, error: "secret provider payload" }, 500),
    json({ ok: false, error: "toString" }, 500),
    new Response("<html>secret provider payload</html>", { status: 502 }),
    json({ ok: true }),
    json({ ok: true, taskId: { secret: "secret provider payload" } }),
  ])("rejects unknown or malformed replies without exposing them", async response => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response);
    const error = await requestReverseController(input, request).catch(e => e);
    expect(error.status).toBe(503);
    expect(error.message).toContain("Check attempts before retrying");
    expect(error.message).not.toMatch(/secret provider payload|toString/);
  });

  it("accepts cancellation without a task ID", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));
    await expect(requestReverseController({ ...input, action: "cancel" }, request)).resolves.toEqual({ ok: true });
  });
});
