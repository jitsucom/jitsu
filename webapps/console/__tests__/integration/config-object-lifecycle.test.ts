import { describe, expect, it, vi } from "vitest";
import { randomId } from "juava";
import { http, HttpResponse } from "msw";
import { server } from "./support/msw";
import { deps, seedWorkspace } from "./support/harness";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { MutationContext, runConfigMutation } from "../../lib/server/config-object-lifecycle";

async function context(): Promise<MutationContext> {
  const { user, workspace } = await seedWorkspace();
  return {
    operation: "create",
    id: randomId(),
    user,
    workspace: await deps().prisma.workspace.findUniqueOrThrow({ where: { id: workspace.id } }),
    next: { name: "hook test" },
  };
}

describe("config mutation transaction boundaries", () => {
  it("prepares outside the lock, passes preparation to validation, and releases locks before afterCommit", async () => {
    const prisma = deps().prisma;
    const ctx = await context();
    const key = `hook-test:${ctx.id}`;
    const preparation = { inspected: ctx.id };
    let preparedUnderLock: unknown;
    let visibleAfterCommit: unknown;
    let lockAvailableBefore = false;
    let lockAvailableAfter = false;
    const tryLock = () =>
      prisma.$transaction(async tx => {
        const [row] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
        return row.locked;
      });
    await runConfigMutation(
      prisma,
      {
        lockKeys: () => [key, key],
        prepare: async () => {
          lockAvailableBefore = await tryLock();
          return preparation;
        },
        beforeWrite: async ({ tx }, prepared) => {
          preparedUnderLock = prepared;
          const available = await tryLock();
          if (available) throw new Error("mutation lock is not held");
          await tx.workspace.update({ where: { id: ctx.workspace.id }, data: { name: "validated" } });
        },
        afterCommit: async () => {
          visibleAfterCommit = await prisma.configurationObject.findUnique({ where: { id: ctx.id } });
          lockAvailableAfter = await tryLock();
        },
      },
      ctx,
      tx =>
        tx.configurationObject.create({
          data: { id: ctx.id, workspaceId: ctx.workspace.id, type: "stream", config: ctx.next },
        })
    );
    expect(preparedUnderLock).toBe(preparation);
    expect(visibleAfterCommit).toMatchObject({ id: ctx.id });
    expect(lockAvailableBefore).toBe(true);
    expect(lockAvailableAfter).toBe(true);
  });

  it.each(["prepare", "beforeWrite", "write"] as const)(
    "does not commit or run side effects when %s fails",
    async stage => {
      const prisma = deps().prisma;
      const ctx = await context();
      let afterCommit = false;
      let wrote = false;
      await expect(
        runConfigMutation(
          prisma,
          {
            prepare: async () => {
              if (stage === "prepare") throw new Error("rejected");
            },
            beforeWrite: async ({ tx }) => {
              await tx.workspace.update({ where: { id: ctx.workspace.id }, data: { name: "must roll back" } });
              if (stage === "beforeWrite") throw new Error("rejected");
            },
            afterCommit: async () => {
              afterCommit = true;
            },
          },
          ctx,
          async tx => {
            wrote = true;
            await tx.configurationObject.create({
              data: { id: ctx.id, workspaceId: ctx.workspace.id, type: "stream", config: {} },
            });
            throw new Error("rejected");
          }
        )
      ).rejects.toThrow("rejected");
      expect(wrote).toBe(stage === "write");
      expect(afterCommit).toBe(false);
      expect(await prisma.configurationObject.findUnique({ where: { id: ctx.id } })).toBeNull();
      expect(await prisma.workspace.findUnique({ where: { id: ctx.workspace.id } })).toMatchObject({
        name: ctx.workspace.name,
      });
    }
  );

  it("returns success for a committed write even if its best-effort side effect fails", async () => {
    const prisma = deps().prisma;
    const ctx = await context();
    const saved = await runConfigMutation(
      prisma,
      {
        afterCommit: async () => {
          throw new Error("provisioner offline");
        },
      },
      ctx,
      tx =>
        tx.configurationObject.create({
          data: { id: ctx.id, workspaceId: ctx.workspace.id, type: "stream", config: {} },
        })
    );
    expect(saved.id).toBe(ctx.id);
    expect(await prisma.configurationObject.findUnique({ where: { id: ctx.id } })).not.toBeNull();
  });
});

describe("config service lifecycle hooks", () => {
  it("rolls back cascaded links if the object delete fails", async () => {
    const { prisma } = deps();
    const { user, workspace } = await seedWorkspace();
    const stream = await prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "stream", config: {} },
    });
    const dest = await prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "destination", config: {} },
    });
    const link = await prisma.configurationObjectLink.create({
      data: { workspaceId: workspace.id, fromId: stream.id, toId: dest.id },
    });
    const failing = prisma.$extends({
      query: {
        configurationObject: {
          update: async () => {
            throw new Error("delete failed");
          },
        },
      },
    });
    await expect(
      new ConfigObjectsService({ prisma: failing as any }).delete(user, workspace.id, "stream", stream.id, {
        cascade: true,
      })
    ).rejects.toThrow("delete failed");
    expect(await prisma.configurationObjectLink.findUnique({ where: { id: link.id } })).toMatchObject({
      deleted: false,
    });
    expect(await prisma.configurationObject.findUnique({ where: { id: stream.id } })).toMatchObject({ deleted: false });
  });

  it("provisions ingress only after the stream is visible on another database connection", async () => {
    const { user, workspace } = await seedWorkspace();
    vi.stubEnv("INGMGR_URL", "http://ingmgr.test.local");
    const id = randomId();
    const domain = `${randomId(8).toLowerCase()}.example.com`;
    let visibleAtProvision: unknown;
    server.use(
      http.get("http://ingmgr.test.local/api/domain", async () => {
        visibleAtProvision = await deps().prisma.configurationObject.findUnique({ where: { id } });
        return HttpResponse.json({ status: "ok" });
      })
    );
    await new ConfigObjectsService({ prisma: deps().prisma }).create(user, workspace.id, "stream", {
      id,
      name: "site",
      domains: [domain],
    });
    expect(visibleAtProvision).toMatchObject({ id, config: { domains: [domain] } });
  });

  it("does not provision ingress if persistence fails after validation", async () => {
    const { prisma } = deps();
    const { user, workspace } = await seedWorkspace();
    vi.stubEnv("INGMGR_URL", "http://ingmgr.test.local");
    let calls = 0;
    server.use(
      http.get("http://ingmgr.test.local/api/domain", () => {
        calls++;
        return HttpResponse.json({ status: "ok" });
      })
    );
    const failing = prisma.$extends({
      query: {
        configurationObject: {
          create: async () => {
            throw new Error("write failed");
          },
        },
      },
    });
    await expect(
      new ConfigObjectsService({ prisma: failing as any }).create(user, workspace.id, "stream", {
        id: randomId(),
        name: "site",
        domains: [`${randomId(8).toLowerCase()}.example.com`],
      })
    ).rejects.toThrow("write failed");
    expect(calls).toBe(0);
  });
});
