import { describe, expect, it } from "vitest";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import { withSchemaDefaults } from "../../lib/schema/config-objects";
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

describe("empty optional targets", () => {
  it("an empty endpoint is the same as an omitted one", () => {
    const stored = { accessKeyId: "AKIA", secretAccessKey: "real" };
    const submitted = { accessKeyId: "AKIA", endpoint: "", secretAccessKey: MASKED_SECRET };
    expect(changedConnectionTargets(submitted, stored)).toEqual([]);
    expect(unmaskSecretsFromOriginal(submitted, stored)).toMatchObject({ secretAccessKey: "real" });
  });

  it("a real endpoint is still a change from an omitted one", () => {
    const submitted = { accessKeyId: "AKIA", endpoint: "https://attacker.example", secretAccessKey: MASKED_SECRET };
    expect(changedConnectionTargets(submitted, { accessKeyId: "AKIA" })).toEqual(["endpoint"]);
  });
});

describe("withSchemaDefaults", () => {
  it("applies defaults to a stored config that has no id and no workspaceId, and adds neither", () => {
    const stored = { type: "destination", destinationType: "posthog", name: "ph", key: "phc_real" };
    const out = withSchemaDefaults("destination", stored);
    expect(out.host).toBe("https://app.posthog.com");
    expect(out).not.toHaveProperty("id");
    expect(out).not.toHaveProperty("workspaceId");
  });
});

describe("connection string injection (Postgres and Redshift)", () => {
  const stored = {
    destinationType: "postgres",
    host: "db.customer.com",
    database: "events",
    username: "jitsu",
    password: "real",
  };

  it.each([
    ["database", "events host=attacker.example"],
    ["username", "jitsu host=attacker.example"],
    ["defaultSchema", "public host=attacker.example"],
    ["database", "events\thost=attacker.example"],
    ["database", "'events host=attacker.example'"],
    ["database", "events\\ host=attacker.example"],
  ])("refuses unmasking with %s = %j", (field, value) => {
    const submitted = { ...stored, [field]: value, password: MASKED_SECRET };
    expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(new RegExp(`${field} contains a space`));
  });

  it("refuses a saved config that keeps the password while a field carries the injection", () => {
    const patch = { database: "events host=attacker.example" };
    expect(() => assertSecretsStayWithTarget(stored, patch, { ...stored, ...patch }, ["password"])).toThrow(
      /database contains a space/
    );
    const withMasked = { ...patch, password: MASKED_SECRET };
    expect(() => assertSecretsStayWithTarget(stored, withMasked, { ...stored, ...withMasked }, ["password"])).toThrow(
      /database contains a space/
    );
  });

  it("applies to Redshift too", () => {
    const redshift = { ...stored, destinationType: "redshift" };
    expect(() =>
      unmaskSecretsFromOriginal({ ...redshift, database: "x host=attacker.example", password: MASKED_SECRET }, redshift)
    ).toThrow(/database contains a space/);
  });

  it("lets ordinary names through, and a new password makes a strange name the editor's own business", () => {
    for (const database of ["events", "events-2026", "events_v2", "my.db", "db$1", "événements"]) {
      expect(
        unmaskSecretsFromOriginal({ ...stored, database, password: MASKED_SECRET }, { ...stored, database })
      ).toMatchObject({ database, password: "real" });
    }
    const patch = { database: "events host=attacker.example", password: "typed-again" };
    expect(() => assertSecretsStayWithTarget(stored, patch, { ...stored, ...patch }, ["password"])).not.toThrow();
  });

  it("ignores whitespace at either end: it cannot start a setting, and such a stored schema has always worked", () => {
    for (const defaultSchema of [" jitsu_events", "jitsu_events ", "\tjitsu_events\n", "  "]) {
      const withEdges = { ...stored, defaultSchema };
      expect(unmaskSecretsFromOriginal({ ...withEdges, password: MASKED_SECRET }, withEdges)).toMatchObject({
        defaultSchema,
        password: "real",
      });
      const patch = { name: "renamed" };
      expect(() =>
        assertSecretsStayWithTarget(withEdges, patch, { ...withEdges, ...patch }, ["password"])
      ).not.toThrow();
    }
  });

  it("still refuses whitespace inside the value, also next to whitespace at the ends", () => {
    for (const value of [
      " events host=attacker.example",
      "events host=attacker.example ",
      "\tevents\thost=attacker.example\n",
    ]) {
      const submitted = { ...stored, database: value, password: MASKED_SECRET };
      expect(() => unmaskSecretsFromOriginal(submitted, stored)).toThrow(/database contains a space/);
    }
  });

  describe("MySQL: the driver splits the DSN at its last @ and /", () => {
    const mysqlStored = {
      destinationType: "mysql",
      host: "db.customer.com",
      database: "events",
      username: "jitsu",
      password: "real",
    };

    it.each([
      "x@tcp(attacker.example:3306)/events",
      "events?tls=false",
      "events/../other",
      "events@evil",
      " x@tcp(attacker.example:3306)/events ",
    ])("refuses unmasking with database = %j", database => {
      const submitted = { ...mysqlStored, database, password: MASKED_SECRET };
      expect(() => unmaskSecretsFromOriginal(submitted, mysqlStored)).toThrow(/database contains @, \/ or \?/);
    });

    it("refuses a saved config that keeps the password while the database carries the address", () => {
      const patch = { database: "x@tcp(attacker.example:3306)/events" };
      expect(() => assertSecretsStayWithTarget(mysqlStored, patch, { ...mysqlStored, ...patch }, ["password"])).toThrow(
        /database contains @, \/ or \?/
      );
    });

    it("lets ordinary names through, user@server usernames included, and a typed password", () => {
      for (const database of ["events", "my-db_2", "db$1", "événements", "a b"]) {
        expect(
          unmaskSecretsFromOriginal({ ...mysqlStored, database, password: MASKED_SECRET }, { ...mysqlStored, database })
        ).toMatchObject({ database, password: "real" });
      }
      const azure = { ...mysqlStored, username: "jitsu@servername" };
      expect(unmaskSecretsFromOriginal({ ...azure, password: MASKED_SECRET }, azure)).toMatchObject({
        password: "real",
      });
      const patch = { database: "x@tcp(attacker.example:3306)/events", password: "typed-again" };
      expect(() =>
        assertSecretsStayWithTarget(mysqlStored, patch, { ...mysqlStored, ...patch }, ["password"])
      ).not.toThrow();
    });
  });

  it("does not touch other destination types", () => {
    const clickhouse = { destinationType: "clickhouse", database: "a b", password: "real" };
    expect(unmaskSecretsFromOriginal({ ...clickhouse, password: MASKED_SECRET }, clickhouse)).toEqual(clickhouse);
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
