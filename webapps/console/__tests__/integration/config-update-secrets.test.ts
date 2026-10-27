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
