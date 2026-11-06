import { describe, expect, it } from "vitest";
import { assertInteractiveAdminSession } from "../../lib/server/admin-become";
import { ApiError } from "../../lib/shared/errors";

describe("assertInteractiveAdminSession", () => {
  it("allows a Firebase session", () => {
    expect(() => assertInteractiveAdminSession({ authType: "firebase" })).not.toThrow();
  });

  it.each(["bearer", "mcp", "next-auth", "oidc", undefined, null])("rejects authType %s with 403", authType => {
    try {
      assertInteractiveAdminSession({ authType });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).status).toBe(403);
    }
  });
});
