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
