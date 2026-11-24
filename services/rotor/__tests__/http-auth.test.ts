import { describe, expect, it } from "vitest";
import { createHash } from "juava";
import { authConfigError, createTokenChecker } from "../src/lib/http-auth";

describe("rotor auth config", () => {
  it("refuses to start without tokens unless auth is disabled explicitly", () => {
    expect(authConfigError({})).toContain("ROTOR_AUTH_DISABLED");
    expect(authConfigError({ ROTOR_AUTH_TOKENS: "", ROTOR_RAW_AUTH_TOKENS: "" })).toContain("ROTOR_AUTH_DISABLED");
    expect(authConfigError({ ROTOR_AUTH_DISABLED: "false" })).toContain("ROTOR_AUTH_DISABLED");
    expect(authConfigError({ ROTOR_AUTH_DISABLED: "true" })).toBeUndefined();
    expect(authConfigError({ ROTOR_RAW_AUTH_TOKENS: "secret-token" })).toBeUndefined();
    expect(authConfigError({ ROTOR_AUTH_TOKENS: createHash("secret-token") })).toBeUndefined();
  });

  it("lets nobody in without tokens, even with an empty or anonymous token", () => {
    const check = createTokenChecker({});
    expect(check("")).toBe(false);
    expect(check("anything")).toBe(false);
    const emptyVars = createTokenChecker({ ROTOR_AUTH_TOKENS: "", ROTOR_RAW_AUTH_TOKENS: "" });
    expect(emptyVars("")).toBe(false);
    expect(emptyVars("anything")).toBe(false);
  });

  it("opens only with an explicit ROTOR_AUTH_DISABLED and no tokens", () => {
    const open = createTokenChecker({ ROTOR_AUTH_DISABLED: "true" });
    expect(open("")).toBe(true);
    expect(open("anything")).toBe(true);
  });

  it("enforces configured raw tokens, also when auth is flagged as disabled", () => {
    for (const disabled of [undefined, "true"]) {
      const check = createTokenChecker({ ROTOR_RAW_AUTH_TOKENS: "token-a,token-b", ROTOR_AUTH_DISABLED: disabled });
      expect(check("token-a")).toBe(true);
      expect(check("token-b")).toBe(true);
      expect(check("token-c")).toBe(false);
      expect(check("")).toBe(false);
    }
  });

  it("enforces configured hashed tokens, also when auth is flagged as disabled", () => {
    for (const disabled of [undefined, "true"]) {
      const check = createTokenChecker({ ROTOR_AUTH_TOKENS: createHash("token-a"), ROTOR_AUTH_DISABLED: disabled });
      expect(check("token-a")).toBe(true);
      expect(check("token-b")).toBe(false);
      expect(check("")).toBe(false);
    }
  });
});
