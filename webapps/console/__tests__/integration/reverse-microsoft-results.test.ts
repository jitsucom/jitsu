import { expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import jwt from "jsonwebtoken";
import { deps, seedWorkspace } from "./support/harness";
import { server } from "./support/msw";
import { reverseMicrosoftOptions } from "../../lib/server/reverse-microsoft-options";
import { readReportTicket, reportTicket, reverseMicrosoftResults } from "../../lib/server/reverse-microsoft-results";
import { MicrosoftAudienceOptions } from "@jitsu/destination-functions/src/functions/microsoft-ads/meta";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import type { NangoConfig } from "../../lib/server/oauth/nango-config";

const nango: NangoConfig = {
  enabled: true,
  nangoApiHost: "https://nango.example.test",
  nangoAppHost: "https://nango.example.test",
  callback: "",
  publicKey: "public",
  secretKey: "secret",
};
const options = { nango, developerToken: "developer-secret", secret: "report-signing-secret" };
async function fixture(stream = "audience", managed = false) {
  const { prisma } = deps();
  const { workspace } = await seedWorkspace();
  await prisma.workspace.update({ where: { id: workspace.id }, data: { featuresEnabled: ["reverse-etl"] } });
  const model = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "model", config: {} },
  });
  const destination = await prisma.configurationObject.create({
    data: { workspaceId: workspace.id, type: "destination", config: {} },
  });
  const config = {
    destinationType: "microsoft-ads",
    customerId: "123",
    accountId: "456",
    oauthIntegrationId: "jitsu-cloud-dst-microsoft-ads",
    oauthConnectionId: `destination.${destination.id}`,
  };
  await prisma.configurationObject.update({ where: { id: destination.id }, data: { config } });
  const streamOptions =
    stream === "audience"
      ? { audience: managed ? { kind: "managed", name: "Customers" } : { kind: "existing", audienceId: "789" } }
      : { conversionName: "Purchase" };
  const link = await prisma.configurationObjectLink.create({
    data: {
      workspaceId: workspace.id,
      fromId: model.id,
      toId: destination.id,
      type: "reverse-sync",
      data: { stream, mode: managed ? "mirror" : "upsert", mapping: { email: "email" }, streamOptions },
    },
  });
  let oauthCalls = 0;
  server.use(
    http.get(`https://nango.example.test/connection/destination.${destination.id}`, () => {
      oauthCalls++;
      return HttpResponse.json({
        connection_id: config.oauthConnectionId,
        provider_config_key: config.oauthIntegrationId,
        credentials: { access_token: "private-access-token", expires_at: new Date(Date.now() + 3600000).toISOString() },
      });
    })
  );
  return { prisma, workspace, destination, link, config, streamOptions, oauthCalls: () => oauthCalls };
}
it("denies foreign workspace, deleted destination, disabled feature and wrong OAuth binding before token lookup", async () => {
  const f = await fixture();
  const other = await fixture();
  await expect(reverseMicrosoftResults(f.prisma, other.workspace.id, f.link.id, undefined, options)).rejects.toThrow(
    "not found"
  );
  await expect(
    reverseMicrosoftOptions(f.prisma, other.workspace.id, f.destination.id, "microsoft-account", nango, "dev")
  ).rejects.toThrow("not found");
  await f.prisma.configurationObject.update({ where: { id: f.destination.id }, data: { deleted: true } });
  await expect(reverseMicrosoftResults(f.prisma, f.workspace.id, f.link.id, undefined, options)).rejects.toThrow(
    "not found"
  );
  await f.prisma.configurationObject.update({
    where: { id: f.destination.id },
    data: { deleted: false, config: { ...f.config, oauthConnectionId: "destination.foreign" } },
  });
  await expect(reverseMicrosoftResults(f.prisma, f.workspace.id, f.link.id, undefined, options)).rejects.toThrow(
    "Authorize this Microsoft Ads destination"
  );
  await f.prisma.workspace.update({ where: { id: f.workspace.id }, data: { featuresEnabled: [] } });
  await expect(reverseMicrosoftResults(f.prisma, f.workspace.id, f.link.id, undefined, options)).rejects.toThrow(
    "not enabled"
  );
  expect(f.oauthCalls()).toBe(0);
});
it("reads only a managed audience with matching ready state and remote ownership", async () => {
  const f = await fixture("audience", true);
  const load = () => reverseMicrosoftResults(f.prisma, f.workspace.id, f.link.id, undefined, options);
  expect(await load()).toMatchObject({ kind: "unavailable", message: expect.stringContaining("not been created") });
  const marker = `jitsu-retl-${"a".repeat(64)}`;
  const state = {
    version: 1,
    phase: "ready",
    marker,
    audienceId: "789",
    binding: contentHash({
      workspace: f.workspace.id,
      sync: f.link.id,
      destination: f.destination.id,
      accountId: "456",
      customerId: "123",
      settings: MicrosoftAudienceOptions.parse(f.streamOptions),
    }),
  };
  await f.prisma.source_state.create({ data: { sync_id: f.link.id, stream: "__jitsu_microsoft_audience_v1", state } });
  server.use(
    http.post(
      "https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/Audiences/QueryByIds",
      async ({ request }) => {
        expect(await request.json()).toEqual({ Type: "CustomerList", AudienceIds: ["789"] });
        return HttpResponse.json({
          Audiences: [
            {
              Id: "789",
              Type: "CustomerList",
              Name: "Customers",
              Description: marker,
              ParentId: "456",
              Scope: "Account",
              MembershipDuration: -1,
              SearchSize: "900",
              AudienceNetworkSize: null,
            },
          ],
        });
      }
    )
  );
  expect(await load()).toMatchObject({ kind: "audience", searchSize: "900", audienceNetworkSize: null });
  const after = await f.prisma.source_state.findUniqueOrThrow({
    where: { sync_id_stream: { sync_id: f.link.id, stream: "__jitsu_microsoft_audience_v1" } },
  });
  expect(after.state).toEqual(state);
  await f.prisma.source_state.update({
    where: { sync_id_stream: { sync_id: f.link.id, stream: "__jitsu_microsoft_audience_v1" } },
    data: { state: { ...state, binding: "wrong" } },
  });
  expect(await load()).toMatchObject({ kind: "unavailable", message: expect.stringContaining("does not match") });
});
it("continues one report, keeps no-data distinct from zero, and invalidates scope changes", async () => {
  const f = await fixture("offline-conversions");
  let submits = 0;
  let polls = 0;
  server.use(
    http.post("https://campaign.api.bingads.microsoft.com/CampaignManagement/v13/ConversionGoals/QueryByIds", () =>
      HttpResponse.json({ ConversionGoals: [{ Id: "12", Name: "Purchase", Type: "OfflineConversion" }] })
    ),
    http.post("https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Submit", () => {
      submits++;
      return HttpResponse.json({ ReportRequestId: "report" });
    }),
    http.post("https://reporting.api.bingads.microsoft.com/Reporting/v13/GenerateReport/Poll", async ({ request }) => {
      polls++;
      expect(await request.json()).toEqual({ ReportRequestId: "report" });
      return HttpResponse.json({
        ReportRequestStatus: polls === 1 ? { Status: "Pending" } : { Status: "Success", ReportDownloadUrl: null },
      });
    })
  );
  const first = await reverseMicrosoftResults(f.prisma, f.workspace.id, f.link.id, undefined, options);
  expect(first.kind).toBe("pending");
  if (first.kind !== "pending") throw new Error();
  expect(JSON.stringify(first)).not.toContain("private-access-token");
  expect(await reverseMicrosoftResults(f.prisma, f.workspace.id, f.link.id, first.continuation, options)).toMatchObject(
    { kind: "pending", continuation: first.continuation }
  );
  expect(await reverseMicrosoftResults(f.prisma, f.workspace.id, f.link.id, first.continuation, options)).toMatchObject(
    { kind: "conversions", totals: [] }
  );
  expect(submits).toBe(1);
  expect(polls).toBe(2);
  expect(await f.prisma.source_task.count({ where: { sync_id: f.link.id } })).toBe(0);
  await f.prisma.configurationObject.update({
    where: { id: f.destination.id },
    data: { config: { ...f.config, accountId: "777" } },
  });
  await expect(
    reverseMicrosoftResults(f.prisma, f.workspace.id, f.link.id, first.continuation, options)
  ).rejects.toThrow("expired or its destination changed");
  expect(polls).toBe(2);
});
it("rejects forged, expired and cross-scope report tickets", () => {
  const value = { binding: "one", reportId: "report", start: "2026-09-01", end: "2026-09-30", goalId: "12" };
  const token = reportTicket(value, options.secret);
  expect(readReportTicket(token, "one", options.secret)).toEqual(value);
  expect(() => readReportTicket(token, "two", options.secret)).toThrow();
  expect(() => readReportTicket(token, "one", "wrong")).toThrow();
  const expired = jwt.sign(value, options.secret, {
    algorithm: "HS256",
    issuer: "jitsu-microsoft-report",
    audience: "jitsu-microsoft-results",
    expiresIn: -1,
  });
  expect(() => readReportTicket(expired, "one", options.secret)).toThrow();
});
