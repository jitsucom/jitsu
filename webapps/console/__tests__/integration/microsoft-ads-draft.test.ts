import { expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { createHmac } from "node:crypto";
import { http, HttpResponse } from "msw";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import { createMicrosoftDraft, microsoftDraftAccounts, readMicrosoftDraft } from "../../lib/server/microsoft-ads-draft";
import type { NangoConfig } from "../../lib/server/oauth/nango-config";

const secret = "draft-signing-secret";
const nango: NangoConfig = {
  enabled: true,
  nangoApiHost: "https://nango.example.test",
  nangoAppHost: "https://nango.example.test",
  callback: "",
  publicKey: "public",
  secretKey: "secret",
};
async function fixture() {
  const { prisma } = deps();
  const { user, workspace } = await seedWorkspace();
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const draft = createMicrosoftDraft(workspace.id, user.internalId, secret);
  let oauthCalls = 0;
  server.use(
    http.get(`https://nango.example.test/connection/destination.${draft.destinationId}`, () => {
      oauthCalls++;
      return HttpResponse.json({
        connection_id: `destination.${draft.destinationId}`,
        provider_config_key: "jitsu-cloud-dst-microsoft-ads",
        credentials: { access_token: "private-access", expires_at: new Date(Date.now() + 3600000).toISOString() },
      });
    }),
    http.post("https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/User/Query", ({ request }) => {
      expect(request.headers.get("DeveloperToken")).toBe("shared-dev-token");
      return HttpResponse.json({ User: { Id: "1" } });
    }),
    http.post("https://clientcenter.api.bingads.microsoft.com/CustomerManagement/v13/Accounts/Search", () =>
      HttpResponse.json({ Accounts: [{ Id: "456", ParentCustomerId: "123", Name: "Account" }] })
    )
  );
  const load = (workspaceId = workspace.id, userId = user.internalId, grant = draft.grant) =>
    microsoftDraftAccounts(
      prisma,
      workspaceId,
      userId,
      grant,
      { secret, nango, developerToken: "shared-dev-token" },
      "ignored-draft-token"
    );
  return { prisma, user, workspace, draft, load, oauthCalls: () => oauthCalls };
}

it("browses an unsaved draft without creating configuration or exposing credentials", async () => {
  const f = await fixture();
  const result = await f.load();
  expect(result.options).toEqual([{ value: "456", label: "Account (456) · customer 123", customerId: "123" }]);
  expect(await f.prisma.configurationObject.findUnique({ where: { id: f.draft.destinationId } })).toBeNull();
  expect(JSON.stringify(result)).not.toContain("private-access");
  expect(f.oauthCalls()).toBe(1);
  // OIDC session consumers use JWT_SECRET directly; even without checking issuer/audience they must reject drafts.
  expect(() => jwt.verify(f.draft.grant, secret)).toThrow("invalid signature");
});

it("rejects another user, workspace, tampered or expired grants, and a disabled feature before reading OAuth", async () => {
  const f = await fixture();
  const other = await fixture();
  await expect(f.load(other.workspace.id)).rejects.toThrow("invalid");
  await expect(f.load(f.workspace.id, other.user.internalId)).rejects.toThrow("invalid");
  await expect(f.load(f.workspace.id, f.user.internalId, f.draft.grant + "bad")).rejects.toThrow("invalid");
  const expired = jwt.sign(
    { workspaceId: f.workspace.id, userId: f.user.internalId, destinationId: f.draft.destinationId },
    createHmac("sha256", secret).update("jitsu-microsoft-draft:v1").digest(),
    {
      algorithm: "HS256",
      issuer: "jitsu-microsoft-draft",
      audience: "jitsu-microsoft-accounts",
      expiresIn: -1,
    }
  );
  await expect(f.load(f.workspace.id, f.user.internalId, expired)).rejects.toThrow("expired");
  expect(() => readMicrosoftDraft(f.draft.grant, f.workspace.id, f.user.internalId, "wrong")).toThrow("invalid");
  await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
  await expect(f.load()).rejects.toThrow("not enabled");
  expect(f.oauthCalls()).toBe(0);
});

it.each([false, true])("rejects a saved or deleted draft before reading OAuth: deleted=%s", async deleted => {
  const f = await fixture();
  await f.prisma.configurationObject.create({
    data: {
      id: f.draft.destinationId,
      workspaceId: f.workspace.id,
      type: "destination",
      deleted,
      config: {},
    },
  });
  await expect(f.load()).rejects.toThrow("already saved");
  expect(f.oauthCalls()).toBe(0);
});
