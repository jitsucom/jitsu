import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import { reverseMetaOptions, reverseMetaCheck } from "../../lib/server/reverse-meta-options";

async function fixture() {
  const { workspace } = await seedWorkspace();
  const { prisma } = deps();
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const destination = await prisma.configurationObject.create({
    data: {
      workspaceId: workspace.id,
      type: "destination",
      config: { destinationType: "facebook-conversions", accessToken: "private-meta-token" },
    },
  });
  return { prisma, workspace, destination };
}
describe("workspace-scoped Meta setup", () => {
  it("uses only the workspace's saved token and returns safe picker data", async () => {
    const f = await fixture();
    let calls = 0;
    server.use(
      http.get("https://graph.facebook.com/v26.0/me/adaccounts", ({ request }) => {
        calls++;
        expect(request.headers.get("Authorization")).toBe("Bearer private-meta-token");
        expect(request.url).not.toContain("private-meta-token");
        return HttpResponse.json({
          data: [{ id: "act_123", account_id: "123", name: "Account" }],
          access_token: "never-return",
        });
      })
    );
    await expect(reverseMetaOptions(f.prisma, "foreign", f.destination.id, "meta-account", {})).rejects.toThrow();
    expect(calls).toBe(0);
    const other = await fixture();
    await expect(
      reverseMetaOptions(f.prisma, other.workspace.id, f.destination.id, "meta-account", {})
    ).rejects.toThrow("not found");
    expect(calls).toBe(0);
    expect(await reverseMetaOptions(f.prisma, f.workspace.id, f.destination.id, "meta-account", {})).toEqual({
      options: [{ value: "123", label: "Account (123)" }],
      truncated: false,
    });
    expect(calls).toBe(1);
  });
  it.each(["deleted", "wrong-provider", "no-token", "no-feature"])("denies %s without contacting Meta", async kind => {
    const f = await fixture();
    if (kind === "no-feature")
      await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
    else
      await f.prisma.configurationObject.update({
        where: { id: f.destination.id },
        data:
          kind === "deleted"
            ? { deleted: true }
            : {
                config:
                  kind === "wrong-provider"
                    ? { destinationType: "google-ads", accessToken: "private-meta-token" }
                    : { destinationType: "facebook-conversions" },
              },
      });
    await expect(
      reverseMetaCheck(f.prisma, f.workspace.id, f.destination.id, "conversions", { pixelId: "789" })
    ).rejects.toThrow();
  });
  it("performs a read-only pixel check without provisioning state or returning credentials", async () => {
    const f = await fixture();
    server.use(
      http.get("https://graph.facebook.com/v26.0/789", ({ request }) => {
        expect(new URL(request.url).searchParams.get("fields")).toBe("id,name,is_unavailable");
        return HttpResponse.json({ id: "789", name: "Pixel", is_unavailable: false, private: "never-return" });
      })
    );
    const result = await reverseMetaCheck(f.prisma, f.workspace.id, f.destination.id, "conversions", {
      pixelId: "789",
    });
    expect(result.name).toBe("Pixel");
    expect(JSON.stringify(result)).not.toMatch(/private-meta-token|never-return/);
    expect(await f.prisma.source_state.count()).toBe(0);
    expect(await f.prisma.configurationObjectLink.count({ where: { workspaceId: f.workspace.id } })).toBe(0);
  });
  it("redacts provider errors but retains actionable token diagnostics", async () => {
    const f = await fixture();
    server.use(
      http.get("https://graph.facebook.com/v26.0/789", () =>
        HttpResponse.json({ error: { code: 190, message: "private-meta-token / never-return" } }, { status: 400 })
      )
    );
    await expect(
      reverseMetaCheck(f.prisma, f.workspace.id, f.destination.id, "conversions", { pixelId: "789" })
    ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("invalid or expired") });
  });
});
