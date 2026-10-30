import { describe, expect, it } from "vitest";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import { assertSecretsStayWithTarget, changedTargetFieldsBetween } from "../../lib/schema/secrets";

const stored = {
  host: "db.customer.com",
  credentials: { server_url: "https://api.customer.com", token: "real-token" },
  token2: "x",
};
const secretPaths = ["credentials.token"];
const merge = (patch: any) => ({
  ...stored,
  ...patch,
  credentials: { ...stored.credentials, ...(patch.credentials ?? {}) },
});

describe("assertSecretsStayWithTarget (nested service secrets)", () => {
  it("allows a patch that does not move the target", () => {
    const patch = { credentials: { token: MASKED_SECRET } };
    expect(() => assertSecretsStayWithTarget(stored, patch, merge(patch), secretPaths)).not.toThrow();
  });

  it("refuses a nested url change that keeps the stored token, masked or omitted", () => {
    for (const patch of [
      { credentials: { server_url: "https://evil.example", token: MASKED_SECRET } },
      { credentials: { server_url: "https://evil.example" } },
    ]) {
      expect(() => assertSecretsStayWithTarget(stored, patch, merge(patch), secretPaths)).toThrow(
        /credentials\.server_url changed/
      );
    }
  });

  it("allows the change when the secret is supplied again", () => {
    const patch = { credentials: { server_url: "https://new.customer.com", token: "new-token" } };
    expect(() => assertSecretsStayWithTarget(stored, patch, merge(patch), secretPaths)).not.toThrow();
  });

  it("does not care when nothing is stored for the secret", () => {
    const empty = { host: "a.example", credentials: {} };
    const patch = { host: "b.example" };
    expect(() => assertSecretsStayWithTarget(empty, patch, { ...empty, ...patch }, secretPaths)).not.toThrow();
  });
});

describe("signing keys", () => {
  it("do not have to be entered again when the url changes: the receiver never gets them", () => {
    const webhook = { url: "https://a.example/hook", signatureSecret: "hmac-key" };
    const patch = { url: "https://b.example/hook" };
    expect(() =>
      assertSecretsStayWithTarget(webhook, patch, { ...webhook, ...patch }, ["signatureSecret"])
    ).not.toThrow();
    // a password next to it still counts
    const both = { ...webhook, password: "pw" };
    expect(() =>
      assertSecretsStayWithTarget(both, patch, { ...both, ...patch }, ["signatureSecret", "password"])
    ).toThrow(/password/);
  });
});

describe("changedTargetFieldsBetween", () => {
  it("treats empty values as no value and ignores non-target fields and port", () => {
    expect(changedTargetFieldsBetween({ host: "", port: 1, name: "x" }, { name: "y" })).toEqual([]);
    expect(changedTargetFieldsBetween({ host: "a" }, { host: "a" })).toEqual([]);
    expect(changedTargetFieldsBetween({ host: "b", url: "u" }, { host: "a" })).toEqual(["host", "url"]);
  });
});
