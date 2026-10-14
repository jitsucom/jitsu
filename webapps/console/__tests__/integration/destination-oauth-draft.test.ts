import { expect, it } from "vitest";
import jwt from "jsonwebtoken";
import { createHmac } from "node:crypto";
import { http, HttpResponse } from "msw";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import {
  createDestinationDraft,
  destinationDraftAccounts,
  readDestinationDraft,
} from "../../lib/server/destination-oauth-draft";
import { savedDestinationAccounts } from "../../lib/server/destination-accounts";
import { accountDiscoveryIntegrations } from "../../lib/schema/destination-accounts";
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
  const draft = createDestinationDraft(workspace.id, user.internalId, "microsoft-ads", secret);
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
    destinationDraftAccounts(
      prisma,
      workspaceId,
      userId,
      "microsoft-ads",
      grant,
      { secret, nango, developerToken: "shared-dev-token" },
      "ignored-draft-token"
    );
  return { prisma, user, workspace, draft, load, oauthCalls: () => oauthCalls };
}

it("browses an unsaved draft without creating configuration or exposing credentials", async () => {
  const f = await fixture();
  const result = await f.load();
  expect(result.options).toEqual([
    { value: "456", label: "Account (456) · customer 123", customerId: "123", accountId: "456" },
  ]);
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
    {
      workspaceId: f.workspace.id,
      userId: f.user.internalId,
      destinationId: f.draft.destinationId,
      destinationType: "microsoft-ads",
      oauthIntegrationId: accountDiscoveryIntegrations["microsoft-ads"],
    },
    createHmac("sha256", secret).update("jitsu-destination-draft:v1").digest(),
    {
      algorithm: "HS256",
      issuer: "jitsu-destination-draft",
      audience: "jitsu-destination-accounts",
      expiresIn: -1,
    }
  );
  await expect(f.load(f.workspace.id, f.user.internalId, expired)).rejects.toThrow("expired");
  expect(() =>
    readDestinationDraft(f.draft.grant, f.workspace.id, f.user.internalId, "microsoft-ads", "wrong")
  ).toThrow("invalid");
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

it("binds drafts to their provider and exact OAuth integration before retrieving tokens", async () => {
  const f = await fixture();
  await expect(
    destinationDraftAccounts(f.prisma, f.workspace.id, f.user.internalId, "google-ads", f.draft.grant, {
      secret,
      nango,
    })
  ).rejects.toThrow("invalid");
  const claims = readDestinationDraft(f.draft.grant, f.workspace.id, f.user.internalId, "microsoft-ads", secret);
  const wrongIntegration = jwt.sign(
    { ...claims, oauthIntegrationId: accountDiscoveryIntegrations["google-ads"] },
    createHmac("sha256", secret).update("jitsu-destination-draft:v1").digest(),
    {
      algorithm: "HS256",
      issuer: "jitsu-destination-draft",
      audience: "jitsu-destination-accounts",
      expiresIn: "1h",
    }
  );
  await expect(f.load(f.workspace.id, f.user.internalId, wrongIntegration)).rejects.toThrow("invalid");
  expect(f.oauthCalls()).toBe(0);
});

it("supports Google drafts without the RETL flag and validates saved ownership and Nango binding", async () => {
  const { prisma } = deps();
  const { user, workspace } = await seedWorkspace(); // Ordinary Google Ads destinations do not require RETL.
  const draft = createDestinationDraft(workspace.id, user.internalId, "google-ads", secret);
  let oauthCalls = 0;
  let badBinding = false;
  server.use(
    http.get(`https://nango.example.test/connection/destination.${draft.destinationId}`, () => {
      oauthCalls++;
      return HttpResponse.json({
        connection_id: `destination.${badBinding ? "foreign" : draft.destinationId}`,
        provider_config_key: accountDiscoveryIntegrations["google-ads"],
        credentials: { access_token: "private-google-token", expires_at: new Date(Date.now() + 3600000).toISOString() },
      });
    }),
    http.get("https://googleads.googleapis.com/v22/customers:listAccessibleCustomers", ({ request }) => {
      expect(request.headers.get("developer-token")).toBe("shared-dev-token");
      return HttpResponse.json({ resourceNames: ["customers/1111111111"] });
    }),
    http.post("https://googleads.googleapis.com/v22/customers/1111111111/googleAds:search", async ({ request }) => {
      const body = (await request.json()) as { query: string };
      return HttpResponse.json(
        body.query.includes("FROM customer_client")
          ? { results: [{ customerClient: { id: "2222222222", descriptiveName: "Ads" } }] }
          : { results: [{ customer: { id: "1111111111", manager: true, status: "ENABLED" } }] }
      );
    })
  );
  const load = () =>
    destinationDraftAccounts(
      prisma,
      workspace.id,
      user.internalId,
      "google-ads",
      draft.grant,
      { secret, nango, developerToken: "shared-dev-token" },
      "ignored-token"
    );
  expect(await load()).toMatchObject({ options: [{ customerId: "2222222222", loginCustomerId: "1111111111" }] });
  expect(await prisma.configurationObject.findUnique({ where: { id: draft.destinationId } })).toBeNull();
  badBinding = true;
  await expect(load()).rejects.toThrow("OAuth is unavailable");
  badBinding = false;
  const config = {
    destinationType: "google-ads",
    oauthIntegrationId: accountDiscoveryIntegrations["google-ads"],
    oauthConnectionId: `destination.${draft.destinationId}`,
  };
  await prisma.configurationObject.create({
    data: { id: draft.destinationId, workspaceId: workspace.id, type: "destination", config },
  });
  const before = oauthCalls;
  await expect(load()).rejects.toThrow("already saved");
  const other = await seedWorkspace();
  await expect(
    savedDestinationAccounts(prisma, other.workspace.id, draft.destinationId, "google-ads", nango)
  ).rejects.toThrow("not found");
  expect(oauthCalls).toBe(before);
  expect(
    await savedDestinationAccounts(prisma, workspace.id, draft.destinationId, "google-ads", nango, "shared-dev-token")
  ).toMatchObject({ options: [{ customerId: "2222222222" }] });
  await prisma.configurationObject.update({ where: { id: draft.destinationId }, data: { deleted: true } });
  await expect(
    savedDestinationAccounts(prisma, workspace.id, draft.destinationId, "google-ads", nango)
  ).rejects.toThrow("not found");
});
