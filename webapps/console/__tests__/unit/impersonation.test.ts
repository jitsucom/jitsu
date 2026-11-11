import { describe, expect, it } from "vitest";
import {
  impersonationCookieLifetimeMs,
  impersonationSessionLifetimeMs as hour,
  impersonationState,
} from "../../lib/shared/impersonation";

const now = Date.UTC(2026, 9, 27, 12, 0, 0);
const authedAgo = (ms: number) => ({ impersonatedBy: "admin", auth_time: (now - ms) / 1000 });

describe("impersonationState", () => {
  it("ignores ordinary sessions", () => {
    expect(impersonationState({ auth_time: 1 }, now)).toEqual({ impersonated: false });
  });

  it("measures the deadline from auth_time, so a refresh at minute 50 leaves 10 minutes", () => {
    expect(impersonationState(authedAgo(50 * 60_000), now)).toEqual({
      impersonated: true,
      expired: false,
      remainingMs: 10 * 60_000,
    });
  });

  it.each([hour, hour + 1, 2 * hour])("is expired %s ms after sign-in", ms => {
    expect(impersonationState(authedAgo(ms), now)).toEqual({ impersonated: true, expired: true });
  });

  it.each([undefined, "x", null])("treats auth_time %s as expired", auth_time => {
    expect(impersonationState({ impersonatedBy: "admin", auth_time }, now)).toEqual({
      impersonated: true,
      expired: true,
    });
  });
});

describe("impersonationCookieLifetimeMs", () => {
  it("never outlives the original deadline", () => {
    expect(impersonationCookieLifetimeMs(10 * 60_000)).toBe(10 * 60_000);
  });

  it("returns undefined below Firebase's five-minute minimum", () => {
    expect(impersonationCookieLifetimeMs(5 * 60_000 - 1)).toBeUndefined();
    expect(impersonationCookieLifetimeMs(5 * 60_000)).toBe(5 * 60_000);
  });
});
