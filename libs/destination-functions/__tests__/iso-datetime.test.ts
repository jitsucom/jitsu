import { describe, expect, it } from "vitest";
import { isoDateTime } from "../src/iso-datetime";

// Expected values were recorded from zod 3.25.76: [input, accepted by z.string().datetime(), accepted by
// z.string().datetime({ offset: true })]. isoDateTime() must keep answering exactly as zod 3 did.
const zod3: [string, boolean, boolean][] = [
  ["2026-11-27T14:30:00Z", true, true],
  ["2026-11-27T14:30:00.1Z", true, true],
  ["2026-11-27T14:30:00.123Z", true, true],
  ["2026-11-27T14:30:00.123456789Z", true, true],
  ["2026-11-27T14:30Z", true, true],
  ["2026-11-27T14:30.5Z", false, false],
  ["2026-11-27T14:30:00z", false, false],
  ["2026-11-27t14:30:00Z", false, false],
  ["2026-11-27 14:30:00Z", false, false],
  ["2026-11-27T14:30:00", false, false],
  ["2026-11-27T14:30", false, false],
  ["2026-11-27", false, false],
  ["", false, false],
  ["2026-11-27T14:30:00Z ", false, false],
  [" 2026-11-27T14:30:00Z", false, false],
  ["2026-11-27T14:30:00+00:00", false, true],
  ["2026-11-27T14:30:00+0000", false, true],
  ["2026-11-27T14:30:00+00", false, false],
  ["2026-11-27T14:30:00+5:30", false, false],
  ["2026-11-27T14:30:00-05:30", false, true],
  ["2026-11-27T14:30:00-0530", false, true],
  ["2026-11-27T14:30+0000", false, true],
  ["2026-11-27T14:30+01:00", false, true],
  ["2026-11-27T14:30:00.123+05:30", false, true],
  ["2026-11-27T14:30:00+24:00", false, true],
  ["2026-11-27T14:30:00+99:99", false, true],
  ["2024-02-29T10:00:00Z", true, true],
  ["2023-02-29T10:00:00Z", false, false],
  ["2026-02-30T10:00:00Z", false, false],
  ["2026-13-01T10:00:00Z", false, false],
  ["2026-00-10T10:00:00Z", false, false],
  ["2026-11-31T10:00:00Z", false, false],
  ["2026-11-32T10:00:00Z", false, false],
  ["2026-04-31T10:00:00Z", false, false],
  ["2000-02-29T00:00:00Z", true, true],
  ["1900-02-29T00:00:00Z", false, false],
  ["0000-01-01T00:00:00Z", true, true],
  ["9999-12-31T23:59:59Z", true, true],
  ["2026-11-27T24:00:00Z", false, false],
  ["2026-11-27T23:59:59Z", true, true],
  ["2026-11-27T23:60:00Z", false, false],
  ["2026-11-27T23:59:60Z", false, false],
  ["2026-11-27T7:30:00Z", false, false],
  ["2026-11-27T07:30:00.Z", false, false],
  ["2026-1-27T07:30:00Z", false, false],
  ["26-11-27T07:30:00Z", false, false],
  ["+2026-11-27T07:30:00Z", false, false],
];

describe("isoDateTime keeps zod 3 datetime behaviour", () => {
  it.each(zod3)("%j", (input, utc, offset) => {
    expect(isoDateTime().safeParse(input).success).toBe(utc);
    expect(isoDateTime({ offset: true }).safeParse(input).success).toBe(offset);
  });

  it("accepts what the destination code goes on to parse", () => {
    for (const value of ["2026-11-27T14:30Z", "2026-11-27T14:30:00+0000", "2026-11-27T14:30:00+05:30"]) {
      expect(isoDateTime({ offset: true }).safeParse(value).success).toBe(true);
      expect(Number.isFinite(Date.parse(value))).toBe(true);
    }
  });

  it("still describes itself as a date-time in generated JSON schema", async () => {
    const { z } = await import("zod");
    const schema = z.toJSONSchema(isoDateTime({ offset: true }), { target: "draft-7" }) as Record<string, unknown>;
    expect(schema.format).toBe("date-time");
    expect(schema.type).toBe("string");
  });
});
