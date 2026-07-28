export const INVALID_HTTP_URL_MESSAGE = "must be a valid HTTP(S) URL, for example https://example.com/webhook";

export function validateHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return INVALID_HTTP_URL_MESSAGE;
  }

  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:" ? undefined : INVALID_HTTP_URL_MESSAGE;
  } catch {
    return INVALID_HTTP_URL_MESSAGE;
  }
}
