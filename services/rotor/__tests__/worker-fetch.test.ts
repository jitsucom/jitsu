import { describe, expect, it } from "vitest";
import {
  deserializeResponse,
  isFetchCallLogged,
  isFetchLogEnabled,
  proxiedFetchTimeoutMs,
  serializeResponse,
} from "../src/lib/worker-fetch";

describe("proxied fetch response", () => {
  const original = () =>
    new Response(new Uint8Array([0, 1, 2, 255]), {
      status: 201,
      statusText: "Created",
      headers: { "Content-Type": "application/octet-stream", "X-One": "1" },
    });

  it("keeps the Response API: headers.get, arrayBuffer, text, json, clone", async () => {
    const res = deserializeResponse(await serializeResponse(original()));
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.status).toBe(201);
    expect(res.ok).toBe(true);
    expect(Array.from(new Uint8Array(await res.clone().arrayBuffer()))).toEqual([0, 1, 2, 255]);
    expect(res.bodyUsed).toBe(false);
  });

  it("reads text and json", async () => {
    const json = deserializeResponse(await serializeResponse(Response.json({ a: 1 })));
    expect(await json.json()).toEqual({ a: 1 });
    const text = deserializeResponse(await serializeResponse(new Response("héllo")));
    expect(await text.text()).toBe("héllo");
  });

  it("can be read more than once, in any combination, like the in-process fetch", async () => {
    const res = deserializeResponse(await serializeResponse(Response.json({ a: 1 })));
    expect(await res.text()).toBe('{"a":1}');
    expect(await res.json()).toEqual({ a: 1 });
    expect(await res.text()).toBe('{"a":1}');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(await res.arrayBuffer()));
    expect(await (await res.blob()).text()).toBe('{"a":1}');
    expect(await res.clone().json()).toEqual({ a: 1 });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("hands out a fresh buffer each time, so one caller cannot change what the next reads", async () => {
    const res = deserializeResponse(await serializeResponse(new Response(new Uint8Array([1, 2, 3]))));
    new Uint8Array(await res.arrayBuffer()).fill(9);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("accepts the shape the Functions Debugger used to send: a decoded text body and a plain headers object", async () => {
    const res = deserializeResponse({
      status: 200,
      statusText: "OK",
      ok: true,
      url: "https://example.com/",
      type: "basic",
      redirected: false,
      headers: { "content-type": "application/json" } as any,
      body: '{"a":1}',
    });
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.text()).toBe('{"a":1}');
    expect(await res.json()).toEqual({ a: 1 });
  });

  it("carries url, type and redirected, which the constructor cannot set", async () => {
    const s = await serializeResponse(original());
    const res = deserializeResponse({ ...s, url: "https://example.com/x", type: "basic", redirected: true });
    expect([res.url, res.type, res.redirected]).toEqual(["https://example.com/x", "basic", true]);
  });

  it("builds responses with a null-body status", async () => {
    const s = await serializeResponse(new Response(null, { status: 204 }));
    expect(deserializeResponse(s).status).toBe(204);
    expect(deserializeResponse({ ...s, status: 304 }).status).toBe(304);
  });
});

describe("isFetchLogEnabled", () => {
  const now = Date.UTC(2026, 9, 27);
  it.each([undefined, "info", "error"])("logs when the level is %s", level => {
    expect(isFetchLogEnabled(level, undefined, now)).toBe(true);
  });
  it("with level debug (nofetchlogs) logs only while debugging is active", () => {
    expect(isFetchLogEnabled("debug", undefined, now)).toBe(false);
    expect(isFetchLogEnabled("debug", new Date(now - 1), now)).toBe(false);
    expect(isFetchLogEnabled("debug", new Date(now + 1000), now)).toBe(true);
  });
});

describe("proxiedFetchTimeoutMs", () => {
  it("uses the requested timeout over the default", () => {
    expect(proxiedFetchTimeoutMs(20000, 2000)).toBe(20000);
  });
  it.each([undefined, null, "5000", 0, -1, NaN, Infinity])("falls back to the default for %s", v => {
    expect(proxiedFetchTimeoutMs(v, 2000)).toBe(2000);
  });
});

describe("isFetchCallLogged", () => {
  it("follows the connection rule when the call says nothing", () => {
    expect(isFetchCallLogged(true)).toBe(true);
    expect(isFetchCallLogged(true, {})).toBe(true);
    expect(isFetchCallLogged(false)).toBe(false);
  });

  it("a call with log:false is not logged, and log:true cannot override a disabled connection", () => {
    expect(isFetchCallLogged(true, { log: false })).toBe(false);
    expect(isFetchCallLogged(true, { log: true })).toBe(true);
    expect(isFetchCallLogged(false, { log: true })).toBe(false);
  });
});
