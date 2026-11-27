import { checkHash } from "../src/security";

// JITSU-302: a configured token that lacks its salt is a misconfiguration, and the value is a credential: it must not be printed.
test("an auth token without a salt is refused without printing it", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(checkHash("RAW-configured-token-VALUE-123", "anything")).toBe(false);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.map(c => c.map(String).join(" ")).join("\n")).not.toContain("RAW-configured-token-VALUE-123");
  } finally {
    spy.mockRestore();
  }
});

test("a well-formed hash is still checked normally and prints nothing", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(checkHash("salt.0000", "wrong")).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});
