import { describe, expect, test } from "vitest";
import { PosthogDestinationConfig } from "../src/meta";

const config = (host: string) => ({ key: "phc_test", host });

describe("PosthogDestinationConfig host", () => {
  test.each([
    "https://posthog.com",
    "https://app.posthog.com",
    "https://analytics.example.co.uk",
    "https://POSTHOG.EXAMPLE.COM",
    "https://xn--e1afmkfd.xn--p1ai",
  ])("accepts domain-only HTTPS host %s", host => {
    expect(PosthogDestinationConfig.safeParse(config(host)).success).toBe(true);
  });

  test.each([
    "posthog.com",
    "http://posthog.com",
    "https://localhost",
    "https://127.0.0.1",
    "https://posthog.com:8443",
    "https://posthog.com/path",
    "https://posthog.com?key=value",
    "https://posthog.com#fragment",
    "https://user:pass@posthog.com",
    "https://-posthog.com",
    "https://posthog-.com",
    "https://post_hog.com",
    "https://posthog..com",
    "https://posthog.com ",
  ])("rejects non-domain PostHog host %s", host => {
    expect(PosthogDestinationConfig.safeParse(config(host)).success).toBe(false);
  });

  test("keeps the existing default full host", () => {
    expect(PosthogDestinationConfig.parse({ key: "phc_test" }).host).toBe("https://app.posthog.com");
  });
});
