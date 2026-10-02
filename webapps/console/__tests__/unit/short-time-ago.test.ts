import { describe, expect, it } from "vitest";
import { shortTimeAgo } from "../../lib/short-time-ago";

describe("shortTimeAgo", () => {
  it.each([
    [-10, "just now"],
    [0, "just now"],
    [4, "just now"],
    [5, "5s ago"],
    [59, "59s ago"],
    [60, "1m ago"],
    [3599, "59m ago"],
    [3600, "1h ago"],
    [86399, "23h ago"],
    [86400, "1d ago"],
    [172800, "2d ago"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    const now = Date.parse("2026-09-21T17:00:00Z");
    expect(shortTimeAgo(new Date(now - seconds * 1000), now)).toBe(expected);
  });
});
