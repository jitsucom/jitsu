import { describe, expect, it } from "vitest";
import { ApiResponseError } from "juava";
import { withoutRequest } from "../../components/ObservabilityExportsEditor/error-details";

// JITSU-283: a rejected save answers 400 after the user typed a new header value, and the editor shows the failed request
// under "Show details".

const request = { method: "PUT", body: { headers: [{ name: "Authorization", value: "typed-secret-77" }] } };

describe("the error shown after a failed save", () => {
  it("does not hold the request, so the typed header value is not displayed", () => {
    const e = new ApiResponseError("The endpoint differs from the saved one.", { message: "x" }, request);
    const shown = withoutRequest(e);
    expect(JSON.stringify(shown.request)).not.toContain("typed-secret-77");
    expect(JSON.stringify({ ...shown })).not.toContain("typed-secret-77");
  });

  it("keeps the message and the response", () => {
    const e = new ApiResponseError("The endpoint differs from the saved one.", { message: "x" }, request);
    const shown = withoutRequest(e);
    expect(shown.message).toBe("The endpoint differs from the saved one.");
    expect(shown.response).toEqual({ message: "x" });
  });

  it("leaves any other error as it is", () => {
    const e = new Error("network down");
    expect(withoutRequest(e)).toBe(e);
  });
});
