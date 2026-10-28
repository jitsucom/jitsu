import { describe, expect, it } from "vitest";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import {
  assertSecretsStayWithTarget,
  changedConnectionTargets,
  changedTargetFieldsBetween,
  unmaskSecretsFromOriginal,
} from "../../lib/schema/secrets";

// JITSU-257: which fields count as "where the stored secret is sent".

describe("list-valued targets (ClickHouse and MongoDB `hosts`)", () => {
  const stored = { hosts: ["ch-1.customer.com:9000", "ch-2.customer.com:9000"], password: "real" };

  it("refuses unmasking into a different list of hosts", () => {
    const submitted = { hosts: ["attacker.example:9000"], password: MASKED_SECRET };
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(/hosts changed/);
    expect(changedConnectionTargets(submitted, stored)).toEqual(["hosts"]);
  });

  it("refuses an extra host", () => {
    const submitted = { hosts: [...stored.hosts, "attacker.example:9000"], password: MASKED_SECRET };
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(/hosts changed/);
  });

  it("unmasks when the list is the same", () => {
    const submitted = { hosts: [...stored.hosts], password: MASKED_SECRET };
    expect(unmaskSecretsFromOriginal(submitted, stored)).toEqual(stored);
  });

  it("refuses a saved config that moves to other hosts and keeps the password", () => {
    const patch = { hosts: ["attacker.example:9000"] };
    expect(() => assertSecretsStayWithTarget(stored, patch, { ...stored, ...patch }, ["password"])).toThrow(
      /hosts changed/
    );
  });

  it("treats an empty list like no value", () => {
    expect(changedTargetFieldsBetween({ hosts: [] }, {})).toEqual([]);
    expect(changedTargetFieldsBetween({ hosts: ["a"] }, {})).toEqual(["hosts"]);
  });
});

describe("API base (Resend, SendGrid)", () => {
  const stored = { apiKey: "real-key", apiBase: "https://api.resend.com" };

  it("refuses a new apiBase that keeps the stored key", () => {
    const submitted = { apiKey: MASKED_SECRET, apiBase: "https://attacker.example" };
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(/apiBase changed/);
    const patch = { apiBase: "https://attacker.example" };
    expect(() => assertSecretsStayWithTarget(stored, patch, { ...stored, ...patch }, ["apiKey"])).toThrow(
      /apiBase changed/
    );
  });
});

describe("Cloud SQL instance (Postgres private service connect)", () => {
  const stored = { authenticationMethod: "google-psc", instanceConnectionName: "proj:region:orig", password: "real" };

  it("refuses unmasking into another instance", () => {
    const submitted = { ...stored, instanceConnectionName: "attacker-proj:region:evil", password: MASKED_SECRET };
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(/instanceConnectionName changed/);
  });

  it("refuses a saved config that moves to another instance and keeps the password", () => {
    const patch = { instanceConnectionName: "attacker-proj:region:evil" };
    expect(() => assertSecretsStayWithTarget(stored, patch, { ...stored, ...patch }, ["password"])).toThrow(
      /instanceConnectionName changed/
    );
  });

  it("unmasks when the instance is the same", () => {
    expect(unmaskSecretsFromOriginal({ ...stored, password: MASKED_SECRET }, stored)).toEqual(stored);
  });
});

describe("Snowflake account (the host name is <account>.snowflakecomputing.com)", () => {
  const stored = { destinationType: "snowflake", account: "orig-acct", username: "jitsu", password: "real" };

  it("refuses unmasking into another account", () => {
    const submitted = { ...stored, account: "attacker-acct", password: MASKED_SECRET };
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(/account changed/);
  });

  it("refuses a saved config that moves to another account and keeps the password", () => {
    const patch = { account: "attacker-acct" };
    expect(() => assertSecretsStayWithTarget(stored, patch, { ...stored, ...patch }, ["password"])).toThrow(
      /account changed/
    );
  });

  it("unmasks when the account is the same", () => {
    expect(unmaskSecretsFromOriginal({ ...stored, password: MASKED_SECRET }, stored)).toEqual(stored);
  });

  it("`account` on anything else is a plain label, not a target", () => {
    const source = { account: "orig", password: "real" };
    const submitted = { account: "other", password: MASKED_SECRET };
    expect(changedConnectionTargets(submitted, source)).toEqual([]);
    expect(unmaskSecretsFromOriginal(submitted, source)).toEqual({ account: "other", password: "real" });
    expect(changedTargetFieldsBetween({ account: "other" }, source)).toEqual([]);
  });
});

describe("TLS material is not a target", () => {
  it("rotating only the server CA keeps the stored password usable", () => {
    const stored = { host: "db.customer.com", password: "real", sslServerCA: "-----OLD CA-----" };
    const submitted = { host: "db.customer.com", password: MASKED_SECRET, sslServerCA: "-----NEW CA-----" };
    expect(changedConnectionTargets(submitted, stored)).toEqual([]);
    expect(unmaskSecretsFromOriginal(submitted, stored)).toMatchObject({ password: "real" });
    const patch = { sslServerCA: "-----NEW CA-----", password: MASKED_SECRET };
    expect(() => assertSecretsStayWithTarget(stored, patch, { ...stored, ...patch }, ["password"])).not.toThrow();
  });

  it("a host change next to a CA change is still refused", () => {
    const stored = { host: "db.customer.com", password: "real", sslServerCA: "old" };
    const submitted = { host: "attacker.example", password: MASKED_SECRET, sslServerCA: "new" };
    expect(changedConnectionTargets(submitted, stored)).toEqual(["host"]);
  });
});

describe("defaults of the stored config", () => {
  const stored = { key: "real-key" }; // PostHog stored without a host
  const withDefaults = { key: "real-key", host: "https://app.posthog.com" };

  it("a submitted default host is not a change once the stored config has its defaults applied", () => {
    const submitted = { key: MASKED_SECRET, host: "https://app.posthog.com" };
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(/host changed/);
    expect(unmaskSecretsFromOriginal(submitted, stored, withDefaults)).toEqual(withDefaults);
  });

  it("another host is still refused", () => {
    const submitted = { key: MASKED_SECRET, host: "https://attacker.example" };
    expect(() => unmaskSecretsFromOriginal(submitted, stored, withDefaults)).toThrow(/host changed/);
  });
});
