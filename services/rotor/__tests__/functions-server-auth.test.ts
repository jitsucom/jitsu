import { describe, expect, it } from "vitest";
import { createHash } from "juava";
import { bearerToken, createFunctionsServerAuth, functionsServerAuthHeaders } from "../src/lib/functions-server-auth";

// JITSU-261: /udfrun and the other functions-server endpoints trusted any caller that could reach the pod.

describe("functions server auth", () => {
  it("is open until tokens are configured", () => {
    const auth = createFunctionsServerAuth({});
    expect(auth.enabled).toBe(false);
    expect(auth.isAuthorized(undefined)).toBe(true);
    expect(auth.isAuthorized("Bearer anything")).toBe(true);
  });

  it("accepts a configured raw token and rejects everything else", () => {
    const auth = createFunctionsServerAuth({ FUNCTIONS_SERVER_RAW_AUTH_TOKENS: "first-token, second-token" });
    expect(auth.enabled).toBe(true);
    expect(auth.isAuthorized("Bearer first-token")).toBe(true);
    expect(auth.isAuthorized("bearer second-token")).toBe(true);
    for (const header of [
      undefined,
      null,
      "",
      "Bearer ",
      "Bearer wrong",
      "Bearer first-token-x",
      "Basic first-token",
      "first-token",
    ]) {
      expect(auth.isAuthorized(header)).toBe(false);
    }
  });

  it("accepts a hashed token", () => {
    const auth = createFunctionsServerAuth({ FUNCTIONS_SERVER_AUTH_TOKENS: createHash("hashed-secret") });
    expect(auth.isAuthorized("Bearer hashed-secret")).toBe(true);
    expect(auth.isAuthorized("Bearer hashed-secre")).toBe(false);
    expect(auth.isAuthorized(undefined)).toBe(false);
  });

  it("parses the bearer header and builds the caller header", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("Token abc")).toBeUndefined();
    expect(functionsServerAuthHeaders("abc")).toEqual({ Authorization: "Bearer abc" });
    expect(functionsServerAuthHeaders(undefined)).toEqual({});
  });
});
