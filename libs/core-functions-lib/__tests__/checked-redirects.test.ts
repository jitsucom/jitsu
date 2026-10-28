import { describe, expect, it } from "vitest";
import { fetchWithCheckedRedirects, MAX_REDIRECTS } from "../src/functions/lib/checked-redirects";

// JITSU-258: under Deno fetch cannot use the guarded agent, so redirects are followed here and every hop is checked.

type Call = { url: string; init: any };

function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetchOnce = async (url: string, init: any) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new Error(`no route for ${url}`);
    return route();
  };
  return { fetchOnce, calls };
}

const redirect = (status: number, location: string) => () => new Response(null, { status, headers: { location } });
const ok =
  (body = "ok") =>
  () =>
    new Response(body, { status: 200 });
const allowAll = async () => {};
const headersOf = (call: Call) => Object.fromEntries(new Headers(call.init.headers));

describe("fetchWithCheckedRedirects", () => {
  it("returns a response that is not a redirect, asking for manual redirect handling", async () => {
    const { fetchOnce, calls } = fakeFetch({ "https://a.example/": ok() });
    const res = await fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/", { method: "GET" });
    expect(await res.text()).toBe("ok");
    expect(calls[0].init.redirect).toBe("manual");
  });

  it("checks every redirect target and never requests one that is refused", async () => {
    const { fetchOnce, calls } = fakeFetch({
      "https://public.example/": redirect(302, "http://169.254.169.254/latest/meta-data/"),
      "http://169.254.169.254/latest/meta-data/": ok("secret"),
    });
    const assertAllowed = async (url: URL) => {
      if (url.hostname === "169.254.169.254") throw new Error("fetch failed");
    };
    await expect(fetchWithCheckedRedirects(fetchOnce, assertAllowed, "https://public.example/", {})).rejects.toThrow(
      "fetch failed"
    );
    expect(calls.map(c => c.url)).toEqual(["https://public.example/"]);
  });

  it("follows allowed redirects, resolving relative locations", async () => {
    const { fetchOnce, calls } = fakeFetch({
      "https://a.example/start": redirect(301, "/next"),
      "https://a.example/next": redirect(307, "https://b.example/end"),
      "https://b.example/end": ok("done"),
    });
    const seen: string[] = [];
    const res = await fetchWithCheckedRedirects(
      fetchOnce,
      async url => void seen.push(url.href),
      "https://a.example/start",
      {}
    );
    expect(await res.text()).toBe("done");
    expect(seen).toEqual(["https://a.example/next", "https://b.example/end"]);
    expect(calls).toHaveLength(3);
  });

  it("stops after too many redirects", async () => {
    const routes: Record<string, () => Response> = {};
    for (let i = 0; i <= MAX_REDIRECTS + 2; i++) routes[`https://loop.example/${i}`] = redirect(302, `/${i + 1}`);
    const { fetchOnce, calls } = fakeFetch(routes);
    await expect(fetchWithCheckedRedirects(fetchOnce, allowAll, "https://loop.example/0", {})).rejects.toThrow(
      /redirects/
    );
    expect(calls).toHaveLength(MAX_REDIRECTS + 1);
  });

  it("refuses a redirect to a scheme other than http(s)", async () => {
    const { fetchOnce } = fakeFetch({ "https://a.example/": redirect(302, "file:///etc/passwd") });
    await expect(fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/", {})).rejects.toThrow(/file:/);
  });

  it("turns a POST into a GET on 302/303 and keeps it on 307, and drops the body only when it turns into a GET", async () => {
    for (const [status, method, body] of [
      [302, "GET", undefined],
      [303, "GET", undefined],
      [307, "POST", "payload"],
      [308, "POST", "payload"],
    ] as const) {
      const { fetchOnce, calls } = fakeFetch({
        "https://a.example/": redirect(status, "https://a.example/two"),
        "https://a.example/two": ok(),
      });
      await fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/", {
        method: "POST",
        body: "payload",
        headers: { "content-type": "text/plain" },
      });
      expect(calls[1].init.method).toBe(method);
      expect(calls[1].init.body).toBe(body);
    }
  });

  it("does not send credentials to another origin", async () => {
    const { fetchOnce, calls } = fakeFetch({
      "https://a.example/": redirect(302, "https://b.example/"),
      "https://b.example/": redirect(302, "https://b.example/two"),
      "https://b.example/two": ok(),
    });
    await fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/", {
      headers: { Authorization: "Bearer x", Cookie: "s=1", "X-Other": "keep" },
    });
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer x", Cookie: "s=1" });
    expect(headersOf(calls[1])).toEqual({ "x-other": "keep" });
    expect(headersOf(calls[2])).toEqual({ "x-other": "keep" });
  });

  it("keeps credentials on a same-origin redirect", async () => {
    const { fetchOnce, calls } = fakeFetch({
      "https://a.example/": redirect(302, "/two"),
      "https://a.example/two": ok(),
    });
    await fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/", {
      headers: { Authorization: "Bearer x" },
    });
    expect(headersOf(calls[1])).toEqual({ authorization: "Bearer x" });
  });

  describe("Response.redirected, as native fetch reports it", () => {
    it("is false when nothing was followed", async () => {
      const { fetchOnce } = fakeFetch({ "https://a.example/": ok() });
      const res = await fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/");
      expect(res.redirected).toBe(false);
    });

    it("is true after one redirect, with the url of the final hop", async () => {
      const { fetchOnce } = fakeFetch({
        "https://a.example/": redirect(302, "https://b.example/final"),
        "https://b.example/final": ok("done"),
      });
      const res = await fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/");
      expect([res.redirected, res.url, await res.text()]).toEqual([true, "https://b.example/final", "done"]);
    });

    it("is true after a chain", async () => {
      const { fetchOnce } = fakeFetch({
        "https://a.example/": redirect(301, "/b"),
        "https://a.example/b": redirect(307, "/c"),
        "https://a.example/c": ok(),
      });
      const res = await fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/");
      expect([res.redirected, res.url]).toEqual([true, "https://a.example/c"]);
    });
  });

  describe("keeps the caller's redirect policy", () => {
    const routes = () => ({
      "https://a.example/": redirect(307, "https://b.example/in"),
      "https://b.example/in": ok("followed"),
    });

    it('with "manual" returns the redirect itself and neither checks nor requests the target', async () => {
      const { fetchOnce, calls } = fakeFetch(routes());
      const checked: string[] = [];
      const res = await fetchWithCheckedRedirects(
        fetchOnce,
        async url => {
          checked.push(url.href);
        },
        "https://a.example/",
        { method: "POST", body: "payload", redirect: "manual" }
      );
      expect([res.status, res.headers.get("location")]).toEqual([307, "https://b.example/in"]);
      expect(calls.map(c => c.url)).toEqual(["https://a.example/"]);
      expect(checked).toEqual([]);
    });

    it('with "error" rejects and does not replay the body to the target', async () => {
      const { fetchOnce, calls } = fakeFetch(routes());
      await expect(
        fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/", {
          method: "POST",
          body: "payload",
          redirect: "error",
        })
      ).rejects.toThrow(/unexpected redirect/);
      expect(calls.map(c => c.url)).toEqual(["https://a.example/"]);
    });

    it.each([undefined, "follow"])("with %s follows it", async redirect => {
      const { fetchOnce, calls } = fakeFetch(routes());
      const res = await fetchWithCheckedRedirects(fetchOnce, allowAll, "https://a.example/", { redirect });
      expect(await res.text()).toBe("followed");
      expect(calls.map(c => c.url)).toEqual(["https://a.example/", "https://b.example/in"]);
    });
  });
});
