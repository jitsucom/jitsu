export const INVALID_WEBHOOK_URL_MESSAGE =
  "must be a valid HTTP(S) URL without embedded credentials, for example https://example.com/webhook";

export function validateWebhookUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return INVALID_WEBHOOK_URL_MESSAGE;
  }

  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === ""
      ? undefined
      : INVALID_WEBHOOK_URL_MESSAGE;
  } catch {
    return INVALID_WEBHOOK_URL_MESSAGE;
  }
}
