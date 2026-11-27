import { describe, expect, it, vi } from "vitest";
import { emptyRuntime, jitsuAnalytics, parseQuery } from "../../src";

describe("parseQuery", () => {
  it("returns an empty object for empty or punctuation-only query strings", () => {
    expect(parseQuery(undefined)).toEqual({});
    expect(parseQuery("")).toEqual({});
    expect(parseQuery("?")).toEqual({});
    expect(parseQuery("??")).toEqual({});
  });

  it("strips leading question marks and preserves = in values", () => {
    expect(parseQuery("??a=1&gclid=EAIaIQobChMI==&redirect=/app?tab=events")).toEqual({
      a: "1",
      gclid: "EAIaIQobChMI==",
      redirect: "/app?tab=events",
    });
  });

  it("decodes + as space while preserving encoded %2B", () => {
    expect(parseQuery("?utm_medium=cpc+ads&label=c%2B%2B")).toEqual({
      utm_medium: "cpc ads",
      label: "c++",
    });
  });

  it("falls back to raw text on malformed percent-encoding", () => {
    expect(parseQuery("?utm_campaign=50%off&utm_source=newsletter")).toEqual({
      utm_campaign: "50%off",
      utm_source: "newsletter",
    });
  });

  it("skips empty segments caused by stray ampersands", () => {
    expect(parseQuery("?a=1&&b=2&")).toEqual({ a: "1", b: "2" });
  });
});

describe("adjustPayload query parsing", () => {
  it("sends page and track events when the URL query contains malformed % or = in click IDs", async () => {
    const sent: any[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const rt = {
      ...emptyRuntime({}),
      pageUrl: () => "https://jitsu.test/pricing?utm_campaign=50%off&utm_medium=cpc+ads&gclid=abc==",
    };
    const client = jitsuAnalytics({
      host: "http://jitsu.test",
      writeKey: "key:secret",
      fetch: fetchMock as any,
      runtime: rt,
    });

    await expect(client.page()).resolves.toBeDefined();
    await expect(client.track("signup")).resolves.toBeDefined();

    expect(sent).toHaveLength(2);
    expect(sent[0].context.campaign).toEqual({
      name: "50%off",
      medium: "cpc ads",
    });
    expect(sent[0].context.clientIds.gclid).toBe("abc==");
  });
});
