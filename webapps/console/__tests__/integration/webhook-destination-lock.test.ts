import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigObjectsService } from "../../lib/server/config-objects-service";
import { readReverseSync } from "../../lib/server/reverse-sync-export";
import { deps, seedWorkspace } from "./support/harness";

// v1 uses one dedicated webhook destination per sync (JITSU-242): a destination bound to a reverse sync cannot be
// edited at all, because the whole destination configuration is part of the sync's revision. These tests pin that
// behaviour, so relaxing it later (WP4) is a deliberate change and not an accident.
const webhookConfig = (extra: Record<string, unknown> = {}) => ({
  destinationType: "webhook",
  name: "client hook",
  url: "https://example.com/hook",
  method: "POST",
  headers: ["X-Env: prod"],
  ...extra,
});

async function setup(opts: { reverseLink: boolean; eventLink: boolean }) {
  const { workspace, user } = await seedWorkspace();
  const { prisma } = deps();
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const warehouse = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: { destinationType: "postgres", host: "never-contact.test" },
    },
  });
  const model = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "model",
      config: { name: "M", warehouseId: warehouse.id, query: "select id from t", primaryKey: ["id"] },
    },
  });
  const created = await new ConfigObjectsService({ prisma }).create(
    user,
    workspace.id,
    "destination",
    { type: "destination", ...webhookConfig() },
    { generateId: true }
  );
  const destination = { id: (created as any).id as string };
  let linkId: string | undefined;
  if (opts.reverseLink) {
    linkId = `retl-${randomUUID().replaceAll("-", "")}`;
    await prisma.configurationObjectLink.create({
      data: {
        id: linkId,
        workspaceId: workspace.id,
        type: "reverse-sync",
        fromId: model.id,
        toId: destination.id,
        data: {
          version: 2,
          name: "S",
          stream: "rows",
          mode: "upsert",
          mapping: { id: "id" },
          streamOptions: {},
          schedule: "",
          timezone: "Etc/UTC",
          disabled: false,
        },
      },
    });
  }
  if (opts.eventLink) {
    const stream = await prisma.configurationObject.create({
      data: { workspaceId: workspace.id, type: "stream", config: { name: "site" } },
    });
    await prisma.configurationObjectLink.create({
      data: {
        id: `ev-${randomUUID().replaceAll("-", "")}`,
        workspaceId: workspace.id,
        type: "push",
        fromId: stream.id,
        toId: destination.id,
        data: {},
      },
    });
  }
  return { prisma, workspace, user, destination, linkId };
}

async function tryUpdate(f: Awaited<ReturnType<typeof setup>>, patch: Record<string, unknown>) {
  const service = new ConfigObjectsService({ prisma: f.prisma });
  try {
    await service.update(f.user, f.workspace.id, "destination", f.destination.id, patch);
    return "UPDATED";
  } catch (e: any) {
    return `REJECTED ${e?.status ?? ""}`;
  }
}

const edits: Record<string, Record<string, unknown>> = {
  rename: { name: "renamed" },
  "rotate signing secret": { signatureMethod: "hmac", signatureSecret: "s3cret" },
  "change URL": { url: "https://example.com/other" },
};

describe("webhook destination edit lock", () => {
  it.each([
    ["reverse sync only", { reverseLink: true, eventLink: false }, "REJECTED 409"],
    ["reverse sync and an event connection", { reverseLink: true, eventLink: true }, "REJECTED 409"],
    ["event connection only", { reverseLink: false, eventLink: true }, "UPDATED"],
    ["no connections", { reverseLink: false, eventLink: false }, "UPDATED"],
  ])(
    "%s",
    async (_name, opts, expected) => {
      const f = await setup(opts);
      for (const [edit, patch] of Object.entries(edits)) expect(await tryUpdate(f, patch), edit).toBe(expected);
    },
    60_000
  );
});

describe("sync revision follows the destination configuration", () => {
  it("any destination change alters configRevision, and reverting it restores the original", async () => {
    const f = await setup({ reverseLink: true, eventLink: false });
    const revision = async () => (await readReverseSync(f.prisma, f.linkId!, f.workspace.id))?.configRevision;
    const base = await revision();
    expect(base).toMatch(/^[a-f0-9]{64}$/);
    const set = async (patch: Record<string, unknown>) => {
      const row = await f.prisma.configurationObject.findFirstOrThrow({ where: { id: f.destination.id } });
      await f.prisma.configurationObject.update({
        where: { id: f.destination.id },
        data: { config: { ...(row.config as any), ...patch } },
      });
      return revision();
    };
    for (const [edit, patch] of Object.entries(edits)) expect(await set(patch), edit).not.toBe(base);
    expect(
      await set({
        name: "client hook",
        signatureMethod: "none",
        signatureSecret: undefined,
        url: "https://example.com/hook",
      })
    ).toBe(base);
  }, 60_000);
});
