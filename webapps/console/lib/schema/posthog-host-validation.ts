export const INVALID_HTTP_URL_MESSAGE = "must be a valid HTTP(S) URL, for example http://localhost:8000/path";
export const INVALID_POSTHOG_URL_MESSAGE =
  "PostHog URLs must use HTTPS without credentials, a port, path, query, or fragment";

export function validatePosthogHost(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return INVALID_HTTP_URL_MESSAGE;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return INVALID_HTTP_URL_MESSAGE;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return INVALID_HTTP_URL_MESSAGE;
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const isPosthog = hostname === "posthog.com" || hostname.endsWith(".posthog.com");

  if (
    isPosthog &&
    (url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname.length > 1 ||
      url.search ||
      url.hash)
  ) {
    return INVALID_POSTHOG_URL_MESSAGE;
  }

  return undefined;
}
