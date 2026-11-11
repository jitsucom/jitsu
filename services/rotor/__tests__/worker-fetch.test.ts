import { describe, expect, it } from "vitest";
import {
  deserializeResponse,
  hideSensitiveHeaders,
  isFetchCallLogged,
  isFetchLogEnabled,
  parseLoggedResponse,
  proxiedFetchTimeoutMs,
  responseBodyText,
  serializeResponse,
  trimLoggedResponse,
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
    // as in the previous worker response and the in-process buffered response; the body is still readable
    expect(res.bodyUsed).toBe(true);
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

// The http-request log entry of a paid function's fetch carries the same details as the in-process fetch's.
describe("fetch log details", () => {
  it("hides the sensitive request headers and keeps the rest", () => {
    expect(
      hideSensitiveHeaders({
        Authorization: "Bearer a",
        "Proxy-Authorization": "Basic b",
        "X-Auth-Token": "c",
        "X-Trace": "t1",
        "Content-Type": "application/json",
      })
    ).toEqual({
      Authorization: "*****",
      "Proxy-Authorization": "*****",
      "X-Auth-Token": "*****",
      "X-Trace": "t1",
      "Content-Type": "application/json",
    });
  });

  it("cuts a long response at 1000 characters and says how long it was", () => {
    expect(trimLoggedResponse("short")).toBe("short");
    expect(trimLoggedResponse("a".repeat(1000))).toBe("a".repeat(1000));
    expect(trimLoggedResponse("a".repeat(1500))).toBe(`${"a".repeat(1000)} ... [truncated, length: 1500]`);
  });

  it("logs a JSON response as an object and anything else as text", () => {
    expect(parseLoggedResponse('{"message":"ok"}')).toEqual({ message: "ok" });
    expect(parseLoggedResponse("plain text")).toBe("plain text");
    expect(parseLoggedResponse("")).toBe("");
  });

  it("reads the body text from the proxied bytes, or from a text body", () => {
    const base = { status: 200, statusText: "OK", ok: true, url: "", type: "basic", redirected: false, headers: [] };
    expect(responseBodyText({ ...base, body: new TextEncoder().encode('{"a":1}') })).toBe('{"a":1}');
    expect(responseBodyText({ ...base, body: "text body" })).toBe("text body");
  });
});

// The free class and the Functions Debugger used to get a plain headers object, so `res.headers["x-next-page"]`
// returned the value. The rebuilt Response keeps `.get()` and that access, so existing UDFs keep working.
describe("legacy header access on the rebuilt Response", () => {
  const response = () =>
    deserializeResponse({
      status: 200,
      statusText: "OK",
      ok: true,
      url: "https://example.com/",
      type: "basic",
      redirected: false,
      headers: [
        ["x-next-page", "3"],
        ["content-type", "application/json"],
      ],
      body: new Uint8Array(0),
    });

  it("reads a header by name like a plain object, and with .get()", () => {
    const { headers } = response();
    expect(headers["x-next-page"]).toBe("3");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers.get("x-next-page")).toBe("3");
    expect(headers.get("X-Next-Page")).toBe("3");
    expect(headers["x-missing"]).toBeUndefined();
    expect(headers.get("x-missing")).toBeNull();
  });

  it("keeps the Headers methods: has, keys, forEach, iteration", () => {
    const { headers } = response();
    expect(headers.has("x-next-page")).toBe(true);
    expect([...headers.keys()].sort()).toEqual(["content-type", "x-next-page"]);
    const seen: string[] = [];
    headers.forEach((v, k) => seen.push(`${k}=${v}`));
    expect(seen.sort()).toEqual(["content-type=application/json", "x-next-page=3"]);
    expect(Object.fromEntries(headers)).toEqual({ "content-type": "application/json", "x-next-page": "3" });
  });

  it("lists, spreads and serializes like the plain object did", () => {
    const { headers } = response();
    expect(Object.keys(headers).sort()).toEqual(["content-type", "x-next-page"]);
    expect({ ...headers }).toEqual({ "content-type": "application/json", "x-next-page": "3" });
    expect(JSON.parse(JSON.stringify(headers))).toEqual({ "content-type": "application/json", "x-next-page": "3" });
    expect("x-next-page" in headers).toBe(true);
    expect("x-missing" in headers).toBe(false);
  });

  it("keeps the same headers on a clone and for blob()", async () => {
    const res = response();
    expect(res.clone().headers["x-next-page"]).toBe("3");
    expect((await res.blob()).type).toBe("application/json");
  });
});

// Both the previous worker response and the in-process buffered response expose `.body` as the decoded text (and
// bodyUsed as true), so a UDF can `JSON.parse(res.body)`. A native Response has a stream there, which that UDF cannot
// parse, and which cannot be returned inside an event either.
describe("plain body access on the rebuilt Response", () => {
  const response = (body: Uint8Array | string, status = 200) =>
    deserializeResponse({
      status,
      statusText: "OK",
      ok: status >= 200 && status < 300,
      url: "https://example.com/",
      type: "basic",
      redirected: false,
      headers: [["content-type", "application/json"]],
      body,
    });

  it("exposes the decoded text as .body, so JSON.parse(res.body) works", () => {
    const res = response(new TextEncoder().encode('{"message":"ok","n":"é"}'));
    expect(typeof res.body).toBe("string");
    expect(res.body).toBe('{"message":"ok","n":"é"}');
    expect(JSON.parse(res.body as any)).toEqual({ message: "ok", n: "é" });
  });

  it("is the same text before and after text(), json() and arrayBuffer()", async () => {
    const res = response(new TextEncoder().encode('{"a":1}'));
    expect(await res.text()).toBe('{"a":1}');
    expect(res.body).toBe('{"a":1}');
    expect(await res.json()).toEqual({ a: 1 });
    expect(res.body).toBe('{"a":1}');
    expect((await res.arrayBuffer()).byteLength).toBe(7);
  });

  it("can be returned inside an event: it clones, as a stream would not", () => {
    const res = response(new TextEncoder().encode('{"a":1}'));
    expect(() => structuredClone({ response: res.body })).not.toThrow();
    expect(structuredClone({ response: res.body })).toEqual({ response: '{"a":1}' });
  });

  it("reports bodyUsed as true, as both previous responses did, and reads a text body and an empty one", () => {
    expect(response(new TextEncoder().encode("x")).bodyUsed).toBe(true);
    expect(response("text body").body).toBe("text body");
    expect(response(new Uint8Array(0), 204).body).toBe("");
  });

  it("keeps the body on a clone", () => {
    expect(response(new TextEncoder().encode('{"a":1}')).clone().body).toBe('{"a":1}');
  });
});

// A worker answers its caller with postMessage, which structured-clones the result: whatever a UDF puts in an event or
// logs has to be plain data. The previous worker response had a plain headers object, so `event.h = res.headers` and
// `log.info("h", res.headers)` worked; a function or a Proxy in there makes postMessage throw, and the worker then
// replaces the whole result with no events and no logs.
describe("response headers cross a worker message", () => {
  const response = () =>
    deserializeResponse({
      status: 200,
      statusText: "OK",
      ok: true,
      url: "https://example.com/",
      type: "basic",
      redirected: false,
      headers: [
        ["x-next-page", "3"],
        ["content-type", "application/json"],
      ],
      body: new Uint8Array(0),
    });

  it("can be structured-cloned, alone and inside an event or a log", () => {
    const { headers } = response();
    expect(() => structuredClone(headers)).not.toThrow();
    expect(structuredClone(headers)).toEqual({ "x-next-page": "3", "content-type": "application/json" });
    const message = {
      events: [{ type: "track", properties: { upstream: headers } }],
      logs: [{ args: ["h", headers] }],
    };
    expect(() => structuredClone(message)).not.toThrow();
    expect(structuredClone(message).events[0].properties.upstream["x-next-page"]).toBe("3");
  });

  it("is plain enough for JSON and for new Headers(...)", () => {
    const { headers } = response();
    expect(JSON.parse(JSON.stringify(headers))).toEqual({ "x-next-page": "3", "content-type": "application/json" });
    const copy = new Headers(headers as any);
    expect(copy.get("x-next-page")).toBe("3");
    expect(copy.get("Content-Type")).toBe("application/json");
  });
});
