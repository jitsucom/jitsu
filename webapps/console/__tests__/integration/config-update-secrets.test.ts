import { describe, expect, it } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { MASKED_SECRET } from "../../lib/schema/destinations";

// JITSU-257: an update that keeps the stored password must not be able to point the object at another host.

const svc = () => new ConfigObjectsService({ prisma: deps().prisma });

async function seedPg() {
  const { user, workspace } = await seedWorkspace();
  const { id } = await svc().create(
    user,
    workspace.id,
    "destination",
    {
      name: "pg",
      destinationType: "postgres",
      database: "events",
      username: "jitsu",
      password: "hunter2",
      host: "db.customer.com",
    },
    { generateId: true }
  );
  const stored = async () =>
    (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
  return { user, workspace, id, stored };
}

describe("updating a destination that has a stored password", () => {
  it("refuses a new host with the masked password", async () => {
    const { user, workspace, id, stored } = await seedPg();
    await expect(
      svc().update(user, workspace.id, "destination", id, { host: "attacker.example", password: MASKED_SECRET })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/password.*host changed/) });
    expect((await stored()).host).toBe("db.customer.com");
  });

  it("refuses a new host when the patch says nothing about the password", async () => {
    const { user, workspace, id, stored } = await seedPg();
    await expect(
      svc().update(user, workspace.id, "destination", id, { host: "attacker.example" })
    ).rejects.toMatchObject({ status: 400 });
    expect((await stored()).host).toBe("db.customer.com");
  });

  it("refuses a new host with an empty password", async () => {
    const { user, workspace, id } = await seedPg();
    await expect(
      svc().update(user, workspace.id, "destination", id, { host: "attacker.example", password: "" })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses another destination type with the stored password, whatever else the patch carries", async () => {
    const { user, workspace, id, stored } = await seedPg();
    // as MySQL, `parameters` is a target field and the Postgres destination has none: the password would follow it
    const parameters = {
      tls: "false",
      x: "y@tcp(attacker.example:3306)/events?tls=false&allowCleartextPasswords=true",
    };
    for (const patch of [
      { destinationType: "mysql", parameters, password: MASKED_SECRET },
      { destinationType: "mysql", parameters },
    ]) {
      await expect(svc().update(user, workspace.id, "destination", id, patch)).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/destinationType changed/),
      });
    }
    expect(await stored()).toMatchObject({ destinationType: "postgres", password: "hunter2" });
  });

  it("accepts a new host together with a new password", async () => {
    const { user, workspace, id, stored } = await seedPg();
    await svc().update(user, workspace.id, "destination", id, { host: "new.customer.com", password: "fresh-secret" });
    expect(await stored()).toMatchObject({ host: "new.customer.com", password: "fresh-secret" });
  });

  it("keeps working for edits that do not move the connection", async () => {
    const { user, workspace, id, stored } = await seedPg();
    await svc().update(user, workspace.id, "destination", id, {
      name: "renamed",
      username: "other-user",
      host: "db.customer.com",
      password: MASKED_SECRET,
    });
    expect(await stored()).toMatchObject({
      name: "renamed",
      username: "other-user",
      host: "db.customer.com",
      password: "hunter2",
    });
    await svc().update(user, workspace.id, "destination", id, { name: "renamed again" });
    expect((await stored()).password).toBe("hunter2");
  });
});

describe("other kinds of connection targets", () => {
  async function seed(destinationType: string, config: Record<string, any>) {
    const { user, workspace } = await seedWorkspace();
    const { id } = await svc().create(
      user,
      workspace.id,
      "destination",
      { name: destinationType, destinationType, ...config },
      { generateId: true }
    );
    return { user, workspace, id };
  }

  it("refuses new ClickHouse hosts (a list) with the stored password", async () => {
    const { user, workspace, id } = await seed("clickhouse", {
      hosts: ["ch.customer.com:9000"],
      username: "jitsu",
      password: "hunter2",
      database: "events",
    });
    await expect(
      svc().update(user, workspace.id, "destination", id, { hosts: ["attacker.example:9000"] })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/password.*hosts changed/) });
  });

  it("refuses another Cloud SQL instance (Postgres private service connect) with the stored password", async () => {
    const { user, workspace, id } = await seed("postgres", {
      authenticationMethod: "google-psc",
      instanceConnectionName: "proj:region:orig",
      database: "events",
      username: "jitsu",
      password: "hunter2",
    });
    await expect(
      svc().update(user, workspace.id, "destination", id, { instanceConnectionName: "attacker-proj:region:evil" })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/password.*instanceConnectionName changed/),
    });
  });

  it("refuses a Postgres database name that adds a host to the connection string, with the stored password", async () => {
    const { user, workspace, id } = await seed("postgres", {
      host: "db.customer.com",
      database: "events",
      username: "jitsu",
      password: "hunter2",
    });
    await expect(
      svc().update(user, workspace.id, "destination", id, { database: "events host=attacker.example" })
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/password.*database contains a space/),
    });
    await svc().update(user, workspace.id, "destination", id, { database: "events_2" });
  });

  it("keeps editing a Postgres destination whose schema has a leading space, as one in production does", async () => {
    const { user, workspace, id } = await seed("postgres", {
      host: "db.customer.com",
      database: "events",
      username: "jitsu",
      password: "hunter2",
      defaultSchema: " jitsu_events",
    });
    for (const patch of [{ name: "renamed", password: MASKED_SECRET }, { name: "renamed again" }]) {
      await svc().update(user, workspace.id, "destination", id, patch);
      const stored = (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
      expect(stored).toMatchObject({ name: patch.name, defaultSchema: " jitsu_events", password: "hunter2" });
    }
    // a space inside the value is still refused
    await expect(
      svc().update(user, workspace.id, "destination", id, { defaultSchema: " jitsu_events host=attacker.example" })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/defaultSchema contains a space/) });
  });

  it("refuses a MySQL database name that carries another address, with the stored password", async () => {
    const { user, workspace, id } = await seed("mysql", {
      host: "db.customer.com",
      database: "events",
      username: "jitsu@servername",
      password: "hunter2",
    });
    await expect(
      svc().update(user, workspace.id, "destination", id, { database: "x@tcp(attacker.example:3306)/events" })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/password.*database contains @, \/ or \?/) });
    // an ordinary edit of the same destination still keeps its secret
    await svc().update(user, workspace.id, "destination", id, { name: "renamed", database: "events_2" });
    const stored = (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
    expect(stored).toMatchObject({
      name: "renamed",
      database: "events_2",
      username: "jitsu@servername",
      password: "hunter2",
    });
  });

  describe("service connector image", () => {
    const pkg = `airbyte/source-mk-${Math.random().toString(36).slice(2, 8)}`;
    async function seedService() {
      const specs = {
        connectionSpecification: {
          properties: { api_key: { type: "string", airbyte_secret: true }, start_date: { type: "string" } },
        },
      };
      await deps().prisma.source_spec.upsert({
        where: { package_version: { package: pkg, version: "1.0.0" } },
        create: { package: pkg, version: "1.0.0", specs },
        update: { specs },
      });
      await deps().prisma.source_spec.upsert({
        where: { package_version: { package: pkg, version: "1.1.0" } },
        create: { package: pkg, version: "1.1.0", specs },
        update: { specs },
      });
      const { user, workspace } = await seedWorkspace();
      const { id } = await svc().create(
        user,
        workspace.id,
        "service",
        {
          name: "src",
          protocol: "airbyte",
          package: pkg,
          version: "1.0.0",
          credentials: { api_key: "real-key", start_date: "2024-01-01" },
        },
        { generateId: true }
      );
      const stored = async () =>
        (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
      return { user, workspace, id, stored };
    }

    it("refuses another package with the stored credentials, masked or omitted", async () => {
      const { user, workspace, id, stored } = await seedService();
      for (const patch of [
        { package: "attacker/connector", credentials: { api_key: MASKED_SECRET } },
        { package: "attacker/connector" },
      ]) {
        await expect(svc().update(user, workspace.id, "service", id, patch)).rejects.toMatchObject({
          status: 400,
          message: expect.stringMatching(/api_key.*package changed/),
        });
      }
      expect(await stored()).toMatchObject({ package: pkg, credentials: { api_key: "real-key" } });
    });

    async function seedHostService() {
      const hostPkg = `airbyte/source-mk-host-${Math.random().toString(36).slice(2, 8)}`;
      await deps().prisma.source_spec.upsert({
        where: { package_version: { package: hostPkg, version: "1.0.0" } },
        create: {
          package: hostPkg,
          version: "1.0.0",
          specs: {
            connectionSpecification: {
              properties: { host: { type: "string" }, password: { type: "string", airbyte_secret: true } },
            },
          },
        },
        update: {},
      });
      const { user, workspace } = await seedWorkspace();
      const { id } = await svc().create(
        user,
        workspace.id,
        "service",
        {
          name: "src",
          protocol: "airbyte",
          package: hostPkg,
          version: "1.0.0",
          credentials: { host: "db.customer.com", password: "real-pw" },
        },
        { generateId: true }
      );
      const stored = async () =>
        (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
      return { user, workspace, id, stored };
    }

    it("refuses a new nested host with the stored password, also when the patch claims a destination type", async () => {
      const { user, workspace, id, stored } = await seedHostService();
      for (const patch of [
        { credentials: { host: "attacker.example", password: MASKED_SECRET } },
        { credentials: { host: "attacker.example" } },
        { destinationType: "postgres", credentials: { host: "attacker.example", password: MASKED_SECRET } },
        { destinationType: "postgres", credentials: { host: "attacker.example" } },
      ]) {
        await expect(svc().update(user, workspace.id, "service", id, patch)).rejects.toMatchObject({
          status: 400,
          message: expect.stringMatching(/credentials\.host changed/),
        });
      }
      expect(await stored()).toMatchObject({ credentials: { host: "db.customer.com", password: "real-pw" } });
    });

    it("refuses a new nested host when the password is only a property named credentials.password", async () => {
      const { user, workspace, id, stored } = await seedHostService();
      await expect(
        svc().update(user, workspace.id, "service", id, {
          credentials: { host: "attacker.example" },
          "credentials.password": "dummy",
        })
      ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/credentials\.host changed/) });
      expect(await stored()).toMatchObject({ credentials: { host: "db.customer.com", password: "real-pw" } });
    });

    // field layouts of production connector specs (read-only query, 12 Nov 2026): the target is not secret and sits
    // next to a secret field, and the name rule used to miss it
    async function seedSpecService(properties: Record<string, any>, credentials: Record<string, any>) {
      const specPkg = `airbyte/source-mk-spec-${Math.random().toString(36).slice(2, 8)}`;
      await deps().prisma.source_spec.upsert({
        where: { package_version: { package: specPkg, version: "1.0.0" } },
        create: { package: specPkg, version: "1.0.0", specs: { connectionSpecification: { properties } } },
        update: {},
      });
      const { user, workspace } = await seedWorkspace();
      const { id } = await svc().create(
        user,
        workspace.id,
        "service",
        { name: "src", protocol: "airbyte", package: specPkg, version: "1.0.0", credentials },
        { generateId: true }
      );
      const stored = async () =>
        (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
      return { user, workspace, id, stored };
    }

    it("refuses a new MongoDB connection_string (a non-secret field next to the secret password)", async () => {
      const credentials = {
        database_config: { connection_string: "mongodb://db.customer.com:27017", username: "app", password: "real-pw" },
      };
      const { user, workspace, id, stored } = await seedSpecService(
        {
          database_config: {
            type: "object",
            oneOf: [
              {
                properties: {
                  connection_string: { type: "string" },
                  username: { type: "string" },
                  password: { type: "string", airbyte_secret: true },
                },
              },
            ],
          },
        },
        credentials
      );
      for (const databaseConfig of [
        { connection_string: "mongodb://attacker.example:27017", password: MASKED_SECRET },
        { connection_string: "mongodb://attacker.example:27017" },
      ]) {
        await expect(
          svc().update(user, workspace.id, "service", id, { credentials: { database_config: databaseConfig } })
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringMatching(/credentials\.database_config\.connection_string changed/),
        });
      }
      expect(await stored()).toMatchObject({ credentials });
    });

    it("refuses a new WooCommerce shop with the stored API key and secret, and lets other fields change", async () => {
      const credentials = {
        shop: "store.customer.com",
        api_key: "real-key",
        api_secret: "real-secret",
        start_date: "2024-01-01",
      };
      const { user, workspace, id, stored } = await seedSpecService(
        {
          shop: { type: "string" },
          api_key: { type: "string", airbyte_secret: true },
          api_secret: { type: "string", airbyte_secret: true },
          start_date: { type: "string" },
        },
        credentials
      );
      await expect(
        svc().update(user, workspace.id, "service", id, {
          credentials: { shop: "attacker.example", api_key: MASKED_SECRET, api_secret: MASKED_SECRET },
        })
      ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/credentials\.shop changed/) });
      expect(await stored()).toMatchObject({ credentials });
      await svc().update(user, workspace.id, "service", id, {
        credentials: { start_date: "2025-01-01", api_key: MASKED_SECRET, api_secret: MASKED_SECRET },
      });
      expect(await stored()).toMatchObject({
        credentials: {
          shop: "store.customer.com",
          api_key: "real-key",
          api_secret: "real-secret",
          start_date: "2025-01-01",
        },
      });
    });

    it("allows another package when the credentials are entered again, and a new version without them", async () => {
      const { user, workspace, id, stored } = await seedService();
      await svc().update(user, workspace.id, "service", id, {
        version: "1.1.0",
        credentials: { api_key: MASKED_SECRET },
      });
      expect(await stored()).toMatchObject({ package: pkg, version: "1.1.0", credentials: { api_key: "real-key" } });
      await svc().update(user, workspace.id, "service", id, {
        package: "airbyte/source-other",
        credentials: { api_key: "typed-again" },
      });
      expect(await stored()).toMatchObject({
        package: "airbyte/source-other",
        credentials: { api_key: "typed-again" },
      });
    });
  });

  it("refuses a ClickHouse database name that adds a query string to the connection URL, with the stored password", async () => {
    const { user, workspace } = await seedWorkspace();
    const { id } = await svc().create(
      user,
      workspace.id,
      "destination",
      {
        name: "ch",
        destinationType: "clickhouse",
        protocol: "http",
        hosts: ["ch.customer.com:8123"],
        username: "default",
        database: "events",
        password: "real-ch-pw",
      },
      { generateId: true }
    );
    const database = "events?http_proxy=http://attacker.example:8080&pad=1";
    for (const patch of [{ database, password: MASKED_SECRET }, { database }]) {
      await expect(svc().update(user, workspace.id, "destination", id, patch)).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/database contains/),
      });
    }
    const stored = (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
    expect(stored).toMatchObject({ database: "events", password: "real-ch-pw" });
  });

  it("refuses a MongoDB username that moves the connection, or a database that adds options, with the stored password", async () => {
    const { user, workspace } = await seedWorkspace();
    const { id } = await svc().create(
      user,
      workspace.id,
      "destination",
      {
        name: "mongo",
        destinationType: "mongodb",
        protocol: "mongodb",
        hosts: ["db.customer.com:27017"],
        username: "app",
        database: "events",
        collection: "c",
        password: "real-mongo-pw",
      },
      { generateId: true }
    );
    const stored = async () =>
      (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
    for (const patch of [
      { username: "x:y@evil.example:27017/?appName=", password: MASKED_SECRET },
      { username: "x:y@evil.example:27017/?appName=" },
      { database: "events?authMechanism=PLAIN&proxyHost=evil.example&proxyPort=1080" },
    ]) {
      await expect(svc().update(user, workspace.id, "destination", id, patch)).rejects.toMatchObject({
        status: 400,
        message: expect.stringMatching(/(username|database) contains/),
      });
    }
    expect(await stored()).toMatchObject({ username: "app", database: "events", password: "real-mongo-pw" });
    // an ordinary edit keeps the stored password
    await svc().update(user, workspace.id, "destination", id, { name: "renamed", password: MASKED_SECRET });
    expect(await stored()).toMatchObject({ name: "renamed", username: "app", password: "real-mongo-pw" });
  });

  it("refuses another Snowflake account with the stored password", async () => {
    const { user, workspace, id } = await seed("snowflake", {
      authenticationMethod: "password",
      account: "orig-acct",
      warehouse: "wh",
      database: "events",
      username: "jitsu",
      password: "hunter2",
    });
    await expect(
      svc().update(user, workspace.id, "destination", id, { account: "attacker-acct" })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/password.*account changed/) });
  });

  it("tests an S3 destination stored without an endpoint when the submission has an empty one", async () => {
    const { user, workspace, id } = await seed("s3", {
      accessKeyId: "AKIA",
      secretAccessKey: "real-secret",
      bucket: "b",
      region: "us-east-1",
    });
    await expect(
      svc().update(user, workspace.id, "destination", id, { endpoint: "", secretAccessKey: MASKED_SECRET })
    ).resolves.not.toThrow();
  });

  it("refuses a new Resend apiBase with the stored API key", async () => {
    const { user, workspace, id } = await seed("resend", { apiKey: "re_real", apiBase: "https://api.resend.com" });
    await expect(
      svc().update(user, workspace.id, "destination", id, { apiBase: "https://attacker.example" })
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/apiKey.*apiBase changed/) });
  });

  it("accepts rotating only the Postgres server CA with the stored password", async () => {
    const { user, workspace, id } = await seed("postgres", {
      host: "db.customer.com",
      database: "events",
      username: "jitsu",
      password: "hunter2",
      sslServerCA: "-----OLD CA-----",
    });
    await svc().update(user, workspace.id, "destination", id, { sslServerCA: "-----NEW CA-----" });
    const stored = (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
    expect(stored).toMatchObject({ sslServerCA: "-----NEW CA-----", password: "hunter2" });
  });

  it("clones a PostHog destination stored without a host, but not onto another host", async () => {
    const { user, workspace } = await seedWorkspace();
    const source = await deps().prisma.configurationObject.create({
      data: {
        id: "phsrc1",
        workspaceId: workspace.id,
        type: "destination",
        // as ConfigObjectsService stores it: no id and no workspaceId inside the config
        config: {
          type: "destination",
          destinationType: "posthog",
          name: "ph",
          key: "phc_real",
        },
      },
    });
    const clone = (extra: Record<string, any>) =>
      svc().create(
        user,
        workspace.id,
        "destination",
        { name: "copy", destinationType: "posthog", key: MASKED_SECRET, cloneId: source.id, ...extra },
        { generateId: true }
      );
    await expect(clone({ host: "https://app.posthog.com" })).resolves.toBeDefined();
    await expect(clone({ host: "https://attacker.example" })).rejects.toMatchObject({ status: 400 });
  });
});
