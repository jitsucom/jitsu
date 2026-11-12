import { describe, expect, it } from "vitest";
import { ApiResponseError } from "juava";
import { TEST_FAILURE_FALLBACK, testFailureMessage } from "../../lib/shared/test-failure";

// JITSU-257: the destination "Test connection" dialog used to answer "Internal error, see logs for details" for
// every request that threw, which hid the new 400 ("Cannot reuse saved secrets because host changed. Enter the secret
// values again to continue.") that tells the user what to do.
describe("testFailureMessage", () => {
  it("shows the message the server sent, such as the refusal to reuse saved secrets", () => {
    const refusal = "Cannot reuse saved secrets because host changed. Enter the secret values again to continue.";
    expect(testFailureMessage(new ApiResponseError(refusal, { message: refusal }, { url: "/x" }))).toBe(refusal);
    expect(testFailureMessage(new Error(refusal))).toBe(refusal);
  });

  it("accepts a plain string", () => {
    expect(testFailureMessage("Connection refused")).toBe("Connection refused");
  });

  it("falls back to the generic text when there is no usable message", () => {
    for (const nothing of [undefined, null, {}, 42, new Error(""), new Error("   "), ""]) {
      expect(testFailureMessage(nothing), String(nothing)).toBe(TEST_FAILURE_FALLBACK);
    }
  });
});
