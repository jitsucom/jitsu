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
    // all of 127.0.0.0/8 is loopback; the URL parser has already normalized short and numeric forms to four octets
    const isLoopbackV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
    return { host, isLocal: host === "localhost" || isLoopbackV4 || host === "::1" };
  } catch {
    return undefined;
  }
}
