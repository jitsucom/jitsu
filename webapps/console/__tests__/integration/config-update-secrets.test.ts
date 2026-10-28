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
        config: {
          id: "phsrc1",
          type: "destination",
          workspaceId: workspace.id,
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
