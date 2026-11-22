import { describe, expect, it } from "vitest";
import { deps, seedWorkspace } from "./support/harness";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";

// JITSU-280: a config that fails validation must not be echoed back. On an update the object is the stored config merged
// with the patch, so a single bad value (a text in a number field) used to show an editor the stored password, and the
// API handler wrote the same object to the logs.

const svc = () => new ConfigObjectsService({ prisma: deps().prisma });

const SECRET = "hunter2-7f3a";
const HOST = "db.customer-only.example";

async function seedPg() {
  // an editor: the role the ticket is about (it may change configs, but it must not read their stored secrets)
  const { user, workspace } = await seedWorkspace({ role: "editor" });
  const { id } = await svc().create(
    user,
    workspace.id,
    "destination",
    {
      name: "pg",
      destinationType: "postgres",
      database: "events",
      username: "jitsu",
      password: SECRET,
      host: HOST,
    },
    { generateId: true }
  );
  const stored = async () =>
    (await deps().prisma.configurationObject.findUniqueOrThrow({ where: { id } })).config as any;
  return { user, workspace, id, stored };
}

/** The error a promise rejects with; fails the test if it does not reject */
async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to reject");
}

/** What the API handler sends and logs about an error: the message and the response object */
const exposed = (e: any) => JSON.stringify({ message: e.message, ...e.responseObject });

describe("an update that fails validation", () => {
  it("is refused with a 400, not a server error", async () => {
    const { user, workspace, id } = await seedPg();
    const e = await rejection(svc().update(user, workspace.id, "destination", id, { port: "x" }));
    expect(e.status).toBe(400);
  });

  it("sends and logs no value of the merged config, and still names the field that is wrong", async () => {
    const { user, workspace, id } = await seedPg();
    const e = await rejection(svc().update(user, workspace.id, "destination", id, { port: "x" }));
    expect(exposed(e)).not.toContain(SECRET);
    expect(exposed(e)).not.toContain(HOST);
    expect(e.responseObject).not.toHaveProperty("object");
    expect(e.responseObject.error.issues.map((i: any) => i.path.join("."))).toContain("port");
  });

  it("holds when the patch itself carries a secret, and leaves the stored config as it was", async () => {
    const { user, workspace, id, stored } = await seedPg();
    const e = await rejection(
      svc().update(user, workspace.id, "destination", id, { password: "typed-secret-9c1b", port: "x" })
    );
    expect(e.status).toBe(400);
    expect(exposed(e)).not.toContain(SECRET);
    expect(exposed(e)).not.toContain("typed-secret-9c1b");
    expect(await stored()).toMatchObject({ password: SECRET, host: HOST });
  });
});

describe("a create that fails validation", () => {
  it("is refused with a 400 and sends no value of the submitted config", async () => {
    const { user, workspace } = await seedWorkspace({ role: "editor" });
    const e = await rejection(
      svc().create(
        user,
        workspace.id,
        "destination",
        {
          name: "pg",
          destinationType: "postgres",
          database: "events",
          username: "jitsu",
          password: SECRET,
          host: HOST,
          port: "x",
        },
        { generateId: true }
      )
    );
    expect(e.status).toBe(400);
    expect(exposed(e)).not.toContain(SECRET);
    expect(exposed(e)).not.toContain(HOST);
  });
});
