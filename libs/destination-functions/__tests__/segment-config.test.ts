import { describe, expect, test } from "vitest";
import { SegmentCredentials } from "../src/meta";

describe("Segment API Base config", () => {
  test("defaults to the modern US endpoint", () => {
    const result = SegmentCredentials.parse({ writeKey: "test-key" });

    expect(result.apiBase).toBe("https://api.segmentapis.com/v1");
  });

  test.each(["https://api.segmentapis.com/v1", "https://eu1.api.segmentapis.com/v1", "https://api.segment.io/v1"])(
    "accepts supported endpoint %s",
    apiBase => {
      expect(SegmentCredentials.safeParse({ apiBase, writeKey: "test-key" }).success).toBe(true);
    }
  );

  test("rejects an arbitrary custom endpoint", () => {
    expect(
      SegmentCredentials.safeParse({
        apiBase: "https://segment-proxy.example.com/v1",
        writeKey: "test-key",
      }).success
    ).toBe(false);
  });
});
