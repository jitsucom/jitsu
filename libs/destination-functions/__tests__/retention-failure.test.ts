import { describe, expect, it } from "vitest";
import { reverseEtlFailure } from "../src/reverse-etl/failure";

describe("retention storage failure messages", () => {
  it.each([
    [
      "Reverse ETL retention storage upload failed; no delivery is authorized",
      /retention bucket exists and is writable/,
    ],
    ["Reverse ETL retention storage is unavailable; delivery blocked", /no longer configured.*do not reset sync state/],
  ])("%s is shown to the user as readable guidance, not as the raw reason", (reason, expected) => {
    const failure = reverseEtlFailure(new Error(reason));
    expect(failure?.reason).toBe(reason);
    expect(failure?.message).toMatch(expected);
    expect(failure?.message).not.toBe(reason);
  });
});
