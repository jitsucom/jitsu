import { describe, expect, it } from "vitest";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import { changedConnectionTargets, unmaskSecretsFromOriginal } from "../../lib/schema/secrets";
import { ApiError } from "../../lib/shared/errors";

const stored = {
  id: "dst1",
  name: "Prod PG",
  destinationType: "postgres",
  host: "db.customer.com",
  port: 5432,
  username: "jitsu",
  password: "real-password",
  credentials: { endpoint: "https://s3.customer.com", secretKey: "real-secret" },
};

describe("unmaskSecretsFromOriginal", () => {
  it("restores secrets when the connection target is unchanged", () => {
    const submitted = {
      ...stored,
      password: MASKED_SECRET,
      credentials: { ...stored.credentials, secretKey: MASKED_SECRET },
    };
    expect(unmaskSecretsFromOriginal(submitted, stored)).toEqual(stored);
  });

  it("still restores secrets when only non-target fields change", () => {
    const submitted = { ...stored, name: "Renamed", username: "other", password: MASKED_SECRET };
    expect(unmaskSecretsFromOriginal(submitted, stored)).toMatchObject({ name: "Renamed", password: "real-password" });
  });

  it("refuses to restore secrets into a different host", () => {
    const submitted = { ...stored, host: "attacker.example", password: MASKED_SECRET };
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(ApiError);
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(/host changed/);
  });

  it("refuses when the changed target is in a nested object and the masked secret is elsewhere", () => {
    const submitted = {
      ...stored,
      password: MASKED_SECRET,
      credentials: { ...stored.credentials, endpoint: "https://attacker.example" },
    };
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(/credentials\.endpoint changed/);
  });

  it("ignores port, which schema defaults can add, and refuses a newly added url", () => {
    expect(changedConnectionTargets({ ...stored, port: 6543, password: MASKED_SECRET }, stored)).toEqual([]);
    expect(changedConnectionTargets({ ...stored, url: "https://x.example", password: MASKED_SECRET }, stored)).toEqual([
      "url",
    ]);
  });

  it("lets a webhook url change keep a masked signing key, which is never sent to the receiver", () => {
    const webhook = { id: "w", url: "https://a.example/hook", signatureSecret: "hmac-key" };
    const submitted = { ...webhook, url: "https://b.example/hook", signatureSecret: MASKED_SECRET };
    expect(unmaskSecretsFromOriginal(submitted, webhook)).toEqual({ ...submitted, signatureSecret: "hmac-key" });
    // but not when a password is masked as well
    const withPassword = { ...webhook, password: "pw" };
    expect(() => unmaskSecretsFromOriginal({ ...submitted, password: MASKED_SECRET }, withPassword)).toThrow(
      /url changed/
    );
  });

  it("does not care about target changes when nothing is masked", () => {
    const submitted = { ...stored, host: "other.example", password: "typed-by-user" };
    expect(unmaskSecretsFromOriginal(submitted, stored)).toEqual(submitted);
  });
});
