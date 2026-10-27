/**
 * Fetch that follows redirects itself so that every hop can be checked. Deno's native fetch takes no undici
 * dispatcher, so the connect-time guard of `guarded-agent.ts` cannot be used there, and its own redirect following
 * would go wherever a public URL points (loopback, cloud metadata).
 *
 * `assertAllowed` throws when a URL must not be fetched. It is called for each redirect target, not for the first
 * URL, which the caller has checked already. A name can still change its DNS answer between that check and the
 * connection: this closes the redirect path, not rebinding.
 */
export const MAX_REDIRECTS = 10;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type RedirectInit = {
  method?: string;
  body?: any;
  headers?: any; // anything `new Headers()` accepts
  [key: string]: any;
};

export async function fetchWithCheckedRedirects(
  fetchOnce: (url: string, init: any) => Promise<Response>,
  assertAllowed: (url: URL) => Promise<void>,
  url: string,
  init: RedirectInit = {},
  maxRedirects: number = MAX_REDIRECTS
): Promise<Response> {
  let currentUrl = url;
  let currentInit: RedirectInit = { ...init, redirect: "manual" };
  for (let hop = 0; ; hop++) {
    const res = await fetchOnce(currentUrl, currentInit);
    const location = res.headers.get("location");
    if (!REDIRECT_STATUSES.has(res.status) || !location) {
      return res;
    }
    await res.body?.cancel().catch(() => {});
    if (hop >= maxRedirects) {
      throw new Error(`fetch failed: more than ${maxRedirects} redirects`);
    }
    const next = new URL(location, currentUrl);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new Error(`fetch failed: redirect to ${next.protocol}`);
    }
    await assertAllowed(next);

    const sameOrigin = next.origin === new URL(currentUrl).origin;
    const method = (currentInit.method ?? "GET").toUpperCase();
    // As browsers do: 303, and 301/302 after a POST, continue as a GET without the body
    const toGet =
      res.status === 303 ? method !== "HEAD" : (res.status === 301 || res.status === 302) && method === "POST";
    const { body: _body, ...rest } = currentInit;
    currentInit = { ...rest, ...(toGet ? { method: "GET" } : _body !== undefined ? { body: _body } : {}) };
    if (currentInit.headers && (!sameOrigin || toGet)) {
      const headers = new Headers(currentInit.headers);
      if (!sameOrigin) {
        // credentials stay with the origin they were meant for
        for (const name of ["authorization", "cookie", "proxy-authorization"]) headers.delete(name);
      }
      if (toGet) {
        for (const name of ["content-type", "content-length", "content-encoding"]) headers.delete(name);
      }
      currentInit.headers = headers;
    }
    currentUrl = next.toString();
  }
}
