import { describe, expect, test } from "vitest";
import { PosthogDestinationConfig } from "../src/meta";

const config = (host: string) => ({ key: "phc_test", host });

describe("PosthogDestinationConfig host", () => {
  test("keeps the existing default full host", () => {
    expect(PosthogDestinationConfig.parse({ key: "phc_test" }).host).toBe("https://app.posthog.com");
  });

  test.each(["not a URL", "ftp://app.posthog.com/path", "http://app.posthog.com"])(
    "leaves client-only host validation to the console for %s",
    host => {
      expect(PosthogDestinationConfig.safeParse(config(host)).success).toBe(true);
    }
  );
});
