import type { NextApiRequest } from "next";

/**
 * True when the browser says the request was started by another site: it sends `Sec-Fetch-Site: cross-site`
 * (a link, a redirect or a form on a page of another site). Requests of a script, a scheduler or a token client
 * do not carry the header, and `same-origin`, `same-site` and `none` (typed address, bookmark) are not cross-site.
 */
export function isCrossSiteRequest(headers: NextApiRequest["headers"]): boolean {
  const value = headers["sec-fetch-site"];
  return (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() === "cross-site";
}

/** True when the request has an `Authorization: Bearer` header. */
export function hasBearerAuthorizationHeader(headers: NextApiRequest["headers"]): boolean {
  return (headers.authorization ?? "").toLowerCase().startsWith("bearer ");
}

/**
 * A GET that changes state must not run because another site sent the user's browser to it: the session cookies
 * are `SameSite=Lax`, which the browser still attaches to a top-level cross-site navigation.
 *
 * Refuses a cross-site GET or HEAD of a route that changes state, unless it carries an `Authorization: Bearer`
 * header. A link or a redirect of another site cannot set a request header, and a script of another site would need
 * the CORS permission this API does not give. A token in the query string is no such proof: a link can put anything
 * there, and a token that does not match falls back to the session cookie.
 */
export function shouldRefuseCrossSite(
  req: Pick<NextApiRequest, "method" | "headers">,
  route: { mutates?: boolean; rejectCrossSite?: boolean },
  hasBearerHeader: boolean
): boolean {
  if (!route.mutates && !route.rejectCrossSite) {
    return false;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }
  return isCrossSiteRequest(req.headers) && !hasBearerHeader;
}
