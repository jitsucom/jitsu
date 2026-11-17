/**
 * What the OAuth consent page should say about a client's redirect URI. Clients register themselves with any name and
 * any redirect, so the name proves nothing; where the authorization code is sent is what the user can judge.
 */
export function describeRedirect(uri: string | undefined): { host: string; isLocal: boolean } | undefined {
  if (!uri) {
    return undefined;
  }
  try {
    const { hostname } = new URL(uri);
    const host = hostname.replace(/^\[|\]$/g, "");
    return { host, isLocal: host === "localhost" || host === "127.0.0.1" || host === "::1" };
  } catch {
    return undefined;
  }
}
