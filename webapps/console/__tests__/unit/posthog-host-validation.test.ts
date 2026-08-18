import { describe, expect, test } from "vitest";
import {
  INVALID_HTTP_URL_MESSAGE,
  INVALID_POSTHOG_URL_MESSAGE,
  validatePosthogHost,
} from "../../lib/schema/posthog-host-validation";

describe("validatePosthogHost", () => {
  test.each([
    "https://example.com",
    "http://example.com:8080/path?key=value#fragment",
    "http://user:pass@example.com/path",
    "http://localhost:3000/path",
    "http://127.0.0.1:3000",
    "http://[::1]:3000/path",
    "https://posthog.com",
    "https://app.posthog.com",
    "HTTPS://APP.POSTHOG.COM",
    "http://notposthog.com:8000/path",
    "http://posthog.com.evil.com/path",
  ])("accepts supported URL %s", value => {
    expect(validatePosthogHost(value)).toBeUndefined();
  });

  test.each([undefined, "", "not a URL", "ftp://example.com", "mailto:user@example.com"])(
    "rejects invalid HTTP(S) URL %s",
    value => {
      expect(validatePosthogHost(value)).toBe(INVALID_HTTP_URL_MESSAGE);
    }
  );

  test.each([
    "http://posthog.com",
    "http://app.posthog.com",
    "https://user:pass@app.posthog.com",
    "https://app.posthog.com:8443",
    "https://app.posthog.com/path",
    "https://app.posthog.com?key=value",
    "https://app.posthog.com#fragment",
    "http://posthog.com.",
  ])("rejects restricted PostHog URL %s", value => {
    expect(validatePosthogHost(value)).toBe(INVALID_POSTHOG_URL_MESSAGE);
  });
});
