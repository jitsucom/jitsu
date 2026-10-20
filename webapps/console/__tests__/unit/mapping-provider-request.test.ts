import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MappingProviderFailure, requestMappingBatch } from "../../lib/server/mapping-provider-request";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function run(request: typeof fetch, extra: Partial<Parameters<typeof requestMappingBatch>[0]> = {}) {
  const record = vi.fn();
  const promise = requestMappingBatch({
    body: '{"private":"column-name"}',
    apiKey: "private-key",
    signal: new AbortController().signal,
    deadline: Date.now() + 30_000,
    parse: value => value,
    record,
    request,
    ...extra,
  }).then(
    value => ({ value, error: undefined }),
    error => ({ error, value: undefined })
  );
  return { promise, record };
}
const ok = () => new Response('{"ok":true}');

it.each([408, 429, 500, 502, 503, 504, 529])("retries HTTP %s twice with exponential backoff", async status => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(async () => new Response("private response", { status }))
    .mockImplementationOnce(async () => new Response("private response", { status }))
    .mockImplementationOnce(async () => ok());
  const { promise, record } = run(request);
  await vi.runAllTimersAsync();
  expect((await promise).value).toEqual({ ok: true });
  expect(request).toHaveBeenCalledTimes(3);
  expect(record.mock.calls.map(([event]) => event.outcome)).toEqual(["retry", "retry", "success"]);
  expect(record.mock.calls.map(([event]) => event.retryDelayMs)).toEqual([375, 750, undefined]);
  expect(new Set(request.mock.calls.map(([, init]) => init!.body)).size).toBe(1);
  expect(JSON.stringify(record.mock.calls)).not.toMatch(/private|column-name/);
});

it("stops after the second retry", async () => {
  const request = vi.fn<typeof fetch>(async () => new Response("private details", { status: 503 }));
  const { promise, record } = run(request);
  await vi.runAllTimersAsync();
  expect((await promise).error).toMatchObject({ code: "http", status: 503 });
  expect(request).toHaveBeenCalledTimes(3);
  expect(record.mock.calls.at(-1)![0].outcome).toBe("failed");
  expect(vi.getTimerCount()).toBe(0);
});

it.each([400, 401, 403, 404, 413, 415, 422, 501])("does not retry non-transient HTTP %s", async status => {
  const request = vi.fn<typeof fetch>(async () => new Response("private details", { status }));
  const { promise } = run(request);
  await vi.runAllTimersAsync();
  expect((await promise).error).toMatchObject({ code: "http", status });
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  [{ "Retry-After": "2" }, 2000],
  [{ "retry-after-ms": "1500" }, 1500],
  [{ "Retry-After": "Tue, 20 Oct 2026 12:00:05 GMT" }, 5000],
])("honors provider retry headers (%j)", async (headers, expected) => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(async () => new Response("", { status: 429, headers }))
    .mockImplementationOnce(async () => ok());
  const { promise, record } = run(request);
  await vi.runAllTimersAsync();
  expect((await promise).error).toBeUndefined();
  const delay = record.mock.calls[0][0].retryDelayMs;
  if (expected) expect(delay).toBe(expected);
  else expect(delay).toBeGreaterThan(375);
});

it("does not shorten Retry-After to retry past the global deadline", async () => {
  const request = vi.fn<typeof fetch>(async () => new Response("", { status: 429, headers: { "Retry-After": "60" } }));
  const { promise } = run(request);
  await vi.runAllTimersAsync();
  expect((await promise).error).toMatchObject({ code: "http", status: 429 });
  expect(request).toHaveBeenCalledTimes(1);
});

it("retries transient connection failures but not TLS/configuration errors", async () => {
  for (const code of ["ECONNRESET", "EAI_AGAIN", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED"]) {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause: { code, message: "private details" } }))
      .mockImplementationOnce(async () => ok());
    const { promise } = run(request);
    await vi.runAllTimersAsync();
    expect(request).toHaveBeenCalledTimes(code === "CERT_HAS_EXPIRED" ? 1 : 2);
    expect((await promise).error?.code).toBe(code === "CERT_HAS_EXPIRED" ? "internal" : undefined);
  }
});

it("retries interrupted response bodies", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } }));
          },
        })
      )
    )
    .mockImplementationOnce(async () => ok());
  const { promise } = run(request);
  await vi.runAllTimersAsync();
  expect((await promise).error).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(2);
});

it("does not retry malformed JSON or invalid model answers", async () => {
  for (const invalidJson of [true, false]) {
    const request = vi.fn<typeof fetch>(async () => new Response(invalidJson ? "private invalid json" : "{}"));
    const { promise } = run(request, {
      parse: () => {
        throw new MappingProviderFailure("invalid_choices");
      },
    });
    await vi.runAllTimersAsync();
    expect((await promise).error.code).toBe(invalidJson ? "invalid_json" : "invalid_choices");
    expect(request).toHaveBeenCalledTimes(1);
  }
});

const untilAborted: typeof fetch = async (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
  });

it("retries an eight-second attempt timeout", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(untilAborted)
    .mockImplementationOnce(async () => ok());
  const { promise, record } = run(request);
  await vi.runAllTimersAsync();
  expect((await promise).error).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(2);
  expect(record.mock.calls[0][0]).toMatchObject({ category: "timeout", elapsedMs: 8000, outcome: "retry" });
});

it.each(["request", "backoff"])("cancels during %s without starting a new attempt", async phase => {
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>(
    phase === "request" ? untilAborted : async () => new Response("", { status: 503 })
  );
  const { promise } = run(request, { signal: controller.signal });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await vi.runAllTimersAsync();
  expect((await promise).error).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("honors the global deadline during attempts rather than resetting it on retries", async () => {
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>(untilAborted);
  const { promise } = run(request, { signal: controller.signal, deadline: Date.now() + 10_000 });
  setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), 10_000);
  await vi.runAllTimersAsync();
  expect((await promise).error).toMatchObject({ code: "timeout" });
  expect(request).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
