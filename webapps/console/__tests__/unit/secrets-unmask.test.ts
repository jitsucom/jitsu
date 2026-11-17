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

// A service (Airbyte connector) config has no destination schema, its target fields are recognised by name
const service = { ...stored, destinationType: undefined };

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
      ...service,
      password: MASKED_SECRET,
      credentials: { ...service.credentials, endpoint: "https://attacker.example" },
    };
    expect(() => unmaskSecretsFromOriginal(submitted, service)).toThrow(/credentials\.endpoint changed/);
  });

  it("ignores port, which schema defaults can add, and refuses a newly added url", () => {
    expect(changedConnectionTargets({ ...stored, port: 6543, password: MASKED_SECRET }, stored)).toEqual([]);
    expect(
      changedConnectionTargets({ ...service, url: "https://x.example", password: MASKED_SECRET }, service)
    ).toEqual(["url"]);
  });

  it("lets a webhook url change keep a masked signing key, which is never sent to the receiver", () => {
    const webhook = { id: "w", destinationType: "webhook", url: "https://a.example/hook", signatureSecret: "hmac-key" };
    const submitted = { ...webhook, url: "https://b.example/hook", signatureSecret: MASKED_SECRET };
    expect(unmaskSecretsFromOriginal(submitted, webhook)).toEqual({ ...submitted, signatureSecret: "hmac-key" });
    // but not when a password is masked as well
    const withPassword = { ...webhook, password: "pw" };
    expect(() => unmaskSecretsFromOriginal({ ...submitted, password: MASKED_SECRET }, withPassword)).toThrow(
      /url changed/
    );
  });

  it("does not let a secret named like a signing key keep a service's secrets when the connector image changes", () => {
    const service = {
      id: "s",
      package: "airbyte/source-x",
      version: "1.0",
      credentials: { host: "db.customer.com", hmac_key_secret: "real-hmac" },
    };
    const submitted = {
      ...service,
      package: "attacker/connector",
      credentials: { ...service.credentials, hmac_key_secret: MASKED_SECRET },
    };
    expect(() => unmaskSecretsFromOriginal(submitted, service)).toThrow(/package changed/);
    // the stored type decides: adding `destinationType: "webhook"` to the submission does not bring the exemption back
    expect(() => unmaskSecretsFromOriginal({ ...submitted, destinationType: "webhook" }, service)).toThrow(
      /package changed/
    );
  });

  it("does not care about target changes when nothing is masked", () => {
    const submitted = { ...stored, host: "other.example", password: "typed-by-user" };
    expect(unmaskSecretsFromOriginal(submitted, stored)).toEqual(submitted);
  });
});
