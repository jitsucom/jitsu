import { describe, it, expect, vi } from "vitest";
import type { JsonObject, ReverseEtlContext, WriteBatch } from "@jitsu/protocols/reverse-etl";
import { createGoogleConversions, googleAdsOutcomes } from "../src/functions/google-ads-reverse/conversions";
import { createGoogleDataManager, projectGoogleAudience } from "../src/functions/google-ads-reverse";
import { createGoogleAudienceManagement } from "../src/functions/google-ads-reverse/audiences";
import { contentHash, createBufferedSyncStore } from "../src/reverse-etl/identity";
import type { GoogleConversionStream } from "../src/functions/google-ads-reverse/conversion-meta";
import { digest } from "../src/functions/google-ads-reverse/identifiers";

const credentials = {
  authorized: true,
  customerId: "1234567890",
  oauthConnectionId: "destination.dst",
  developerToken: "test-developer-token",
};
const time = "2026-09-20T12:30:00Z";
function fixture(name: GoogleConversionStream = "click-conversions", options: Record<string, unknown> = {}) {
  const settings = { conversionActionId: "321", ...options };
  const adapter = createGoogleConversions(name, credentials, settings, async () => "test-token", "s");
  const fetch = vi.fn(async (_url: any, _init?: RequestInit) => new Response(JSON.stringify({ requestId: "req-1" })));
  const ctx = {
    credentials: adapter.credentials,
    options: settings,
    syncId: "s",
    taskId: "t",
    logicalRunId: "r",
    configRevision: "a".repeat(64),
    targetIdentity: adapter.targetIdentity,
    mode: "upsert",
    fullRefresh: true,
    signal: new AbortController().signal,
    fetch,
    store: createBufferedSyncStore(),
    delivery: {},
    log: { info() {}, warn() {}, error() {}, debug() {} },
  } as unknown as ReverseEtlContext<JsonObject, JsonObject>;
  const batch = (input: Record<string, unknown> = {}): WriteBatch<JsonObject> => ({
    batchId: "b",
    records: [
      {
        key: "a".repeat(64),
        sourceSequence: 1,
        operationId: "op-1",
        row: adapter.stream.rowType.parse({ __sourceKey: "a".repeat(64), ...input }),
      },
    ],
  });
  return { adapter, fetch, ctx, batch };
}
describe("Google Reverse ETL conversion streams", () => {
  it("accepts lossless SQL numeric strings and namespaces generated order IDs by sync", () => {
    const f = fixture();
    const input = {
      __sourceKey: "a".repeat(64),
      conversionTimestamp: time,
      gclid: "click",
      value: "12.50",
      items: [{ productId: "sku", quantity: "2", price: "6.25" }],
    };
    const first = f.adapter.stream.rowType.parse(input).payload as any;
    const other = createGoogleConversions(
      "click-conversions",
      credentials,
      { conversionActionId: "321" },
      async () => "t",
      "other-sync"
    );
    expect(first.conversionValue).toBe(12.5);
    expect(first.cartData.items[0]).toMatchObject({ quantity: 2, unitPrice: 6.25 });
    expect((other.stream.rowType.parse(input).payload as any).transactionId).not.toBe(first.transactionId);
    expect((other.stream.rowType.parse({ ...input, orderId: "shared-order" }).payload as any).transactionId).toBe(
      "shared-order"
    );
  });
  it("handles all-rejected Google Ads responses even when results are omitted", () => {
    const batch = fixture().batch({ conversionTimestamp: time, gclid: "bad" });
    expect(
      googleAdsOutcomes(batch, {
        partialFailureError: {
          code: 3,
          details: [
            {
              errors: [
                {
                  errorCode: { conversionUploadError: "INVALID_GCLID" },
                  location: { fieldPathElements: [{ fieldName: "conversions", index: 0 }] },
                },
              ],
            },
          ],
        },
      }).outcomes[0]
    ).toMatchObject({ status: "rejected", code: "INVALID_GCLID" });
  });
  it("maps and hashes click events, persists a receipt, then polls without reuploading", async () => {
    const f = fixture();
    const batch = f.batch({
      conversionTimestamp: time,
      email: ["alice@example.com", "bob@example.com"],
      phone: "+14155552671",
      value: 0,
      currency: "USD",
      items: [{ productId: "sku", quantity: 2, price: 5 }],
      merchantId: "12",
      transactionDiscount: 1,
      customVariables: { region: "US" },
      sessionAttributes: { gadSource: "1", landingPageUrl: "https://example.com" },
    });
    expect(JSON.stringify(batch)).not.toContain("alice@example.com");
    const writer = await f.adapter.stream.createWriter(f.ctx);
    const saved = await writer.upsert(batch);
    const payload = JSON.parse(f.fetch.mock.calls[0][1]!.body as string);
    expect(payload.events[0]).toMatchObject({
      conversionValue: 0,
      transactionId: `jitsu-${contentHash({ syncId: "s", key: "a".repeat(64) })}`,
      userData: {
        userIdentifiers: [
          { emailAddress: digest("alice@example.com") },
          { emailAddress: digest("bob@example.com") },
          { phoneNumber: digest("+14155552671") },
        ],
      },
      eventSource: "OTHER",
      cartData: { items: [{ merchantProductId: "sku", quantity: 2, unitPrice: 5 }] },
    });
    expect(saved.outcomes[0].status).toBe("staged");
    f.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          requestStatusPerDestination: [
            {
              destination: payload.destinations[0],
              requestStatus: "SUCCESS",
              eventsIngestionStatus: { recordCount: "1" },
            },
          ],
        })
      )
    );
    expect((await f.adapter.recovery().reconcileBatch(batch, "upsert", saved, f.ctx)).outcomes[0].status).toBe(
      "accepted"
    );
    expect(f.fetch.mock.calls[1][1]!.method).toBe("GET");
    await expect(
      f.adapter.recovery().reconcileBatch({ ...batch, batchId: "foreign" }, "upsert", saved, f.ctx)
    ).rejects.toThrow("does not match");
  });
  it("leaves unmapped consent granted but does not turn mapped null/unknown into consent", () => {
    const f = fixture();
    const payload: any = f.batch({
      conversionTimestamp: time,
      gclid: "click",
      adUserData: null,
      adPersonalization: "UNKNOWN",
    }).records[0].row.payload;
    expect(payload.consent).toEqual({
      adUserData: "CONSENT_STATUS_UNSPECIFIED",
      adPersonalization: "CONSENT_STATUS_UNSPECIFIED",
    });
    expect(
      (f.batch({ conversionTimestamp: time, gclid: "click" }).records[0].row.payload as any).consent.adUserData
    ).toBe("CONSENT_GRANTED");
  });
  it.each(["call-conversions", "conversion-adjustments"] as const)("requires the developer token for %s", name => {
    vi.stubEnv("GOOGLE_ADS_DEVELOPER_TOKEN", "");
    try {
      expect(() =>
        createGoogleConversions(
          name,
          { ...credentials, developerToken: undefined },
          { conversionActionId: "321" },
          async () => "t",
          "s"
        )
      ).toThrow("developer token");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("maps call conversion timestamps and caller ID and sends Google Ads authorization", async () => {
    const f = fixture("call-conversions");
    const batch = f.batch({
      callerId: "+1 (415) 555-2671",
      callTimestamp: time,
      conversionTimestamp: "2026-09-20T12:35:00Z",
    });
    f.fetch.mockResolvedValue(
      new Response(JSON.stringify({ results: [{ conversionAction: "customers/1234567890/conversionActions/321" }] }))
    );
    expect((await (await f.adapter.stream.createWriter(f.ctx)).upsert(batch)).outcomes[0].status).toBe("accepted");
    expect(String(f.fetch.mock.calls[0][0])).toContain(":uploadCallConversions");
    expect(f.fetch.mock.calls[0][1]!.headers).toMatchObject({ "developer-token": "test-developer-token" });
    expect(JSON.parse(f.fetch.mock.calls[0][1]!.body as string).conversions[0]).toMatchObject({
      callerId: "+14155552671",
      callStartDateTime: "2026-09-20 12:30:00+00:00",
    });
  });
  it.each(["RETRACTION", "RESTATEMENT", "ENHANCEMENT"])("maps %s without requiring unrelated fields", type => {
    const f = fixture("conversion-adjustments", { adjustmentType: type });
    const row = f.batch({
      orderId: "order",
      adjustmentTimestamp: time,
      ...(type === "RESTATEMENT"
        ? { restatementValue: 0 }
        : type === "ENHANCEMENT"
        ? { email: "alice@example.com" }
        : {}),
    }).records[0].row;
    expect(row.payload).toMatchObject({ adjustmentType: type, orderId: "order" });
    expect((row.payload as any).restatementValue).toEqual(type === "RESTATEMENT" ? { adjustedValue: 0 } : undefined);
  });
  it("does not silently discard unsupported mapped fields", () => {
    expect(() =>
      fixture("click-conversions", { api: "google-ads" }).batch({
        conversionTimestamp: time,
        firstName: "Alice",
        lastName: "Smith-Jones",
        countryCode: "US",
        postalCode: "94107",
      })
    ).toThrow("not address identifiers");
    expect(() => fixture().batch({ conversionTimestamp: time, gclid: "click", merchantCountryCode: "US" })).toThrow(
      "require Google Ads API"
    );
    expect(() =>
      fixture("conversion-adjustments", { adjustmentType: "RESTATEMENT" }).batch({ orderId: "order" })
    ).toThrow("requires a value");
  });
  it("assigns partial failures to exact operation IDs and rejects ambiguous responses", () => {
    const f = fixture();
    const one = f.batch({ conversionTimestamp: time, gclid: "click" });
    const batch = { ...one, records: [...one.records, { ...one.records[0], operationId: "op-2" }] };
    const result = googleAdsOutcomes(batch, {
      results: [{ conversionAction: "action" }, {}],
      partialFailureError: {
        code: 3,
        details: [
          {
            errors: [
              {
                errorCode: { conversionUploadError: "INVALID_GCLID" },
                location: { fieldPathElements: [{ fieldName: "conversions", index: 1 }] },
              },
            ],
          },
        ],
      },
    });
    expect(result.outcomes).toEqual([
      { operationId: "op-1", status: "accepted" },
      {
        operationId: "op-2",
        status: "rejected",
        code: "INVALID_GCLID",
        safeReason: "Google rejected this conversion (INVALID_GCLID)",
      },
    ]);
    expect(() => googleAdsOutcomes(batch, { results: [{}] })).toThrow("incomplete");
    expect(() => googleAdsOutcomes(batch, { results: [{}, {}], partialFailureError: { code: 3 } })).toThrow(
      "cannot be assigned"
    );
  });
  it.each(["PARTIAL_SUCCESS", "FAILED", "PROCESSING"])(
    "handles Data Manager %s without inventing acceptance",
    async state => {
      const f = fixture();
      const batch = f.batch({ conversionTimestamp: time, gclid: "click" });
      const saved = await (await f.adapter.stream.createWriter(f.ctx)).upsert(batch);
      const target = JSON.parse(f.fetch.mock.calls[0][1]!.body as string).destinations[0];
      f.fetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            requestStatusPerDestination: [
              { destination: target, requestStatus: state, eventsIngestionStatus: { recordCount: "1" } },
            ],
          })
        )
      );
      const check = f.adapter.recovery().reconcileBatch(batch, "upsert", saved, f.ctx);
      if (state === "PARTIAL_SUCCESS") await expect(check).rejects.toThrow("manual reconciliation");
      else expect((await check).outcomes[0].status).toBe(state === "FAILED" ? "rejected" : "staged");
    }
  );
});
describe("expanded Google audience identifiers", () => {
  const provider = createGoogleDataManager(async () => "token");
  it("accepts email-only, address-only, CRM-only and mobile-only rows", () => {
    const address = provider.stream.rowType.parse({
      firstName: " Alice ",
      lastName: "Smith-Jones",
      countryCode: "us",
      postalCode: "94107",
    });
    expect(address).toMatchObject({
      userData: {
        userIdentifiers: [
          {
            address: {
              givenName: digest("alice"),
              familyName: digest("smith-jones"),
              regionCode: "US",
              postalCode: "94107",
            },
          },
        ],
      },
    });
    expect(projectGoogleAudience("upsert", address)).toHaveLength(1);
    expect(provider.stream.rowType.parse({ crmId: "crm-1" })).toMatchObject({ userIdData: { userId: "crm-1" } });
    const mobile = provider.stream.rowType.parse({ mobileAdvertisingId: ["one", "two"] });
    expect(projectGoogleAudience("upsert", mobile)).toHaveLength(2);
    expect(provider.stream.rowType.parse({ email: "alice@example.com" })).toBeTruthy();
    expect(() => provider.stream.rowType.parse({ firstName: "Alice" })).toThrow("Address matching requires");
    expect(() => provider.stream.rowType.parse({ crmId: "c", email: "a@b.com" })).toThrow(
      "one audience identifier type"
    );
  });
  it("normalizes arrays once and removal uses exactly the same identities", () => {
    const input = { email: ["ALICE@example.com", "bob@example.com"], phone: "4155552671", phoneCountryCode: "1" };
    const upsert = projectGoogleAudience("upsert", provider.stream.rowType.parse(input));
    const remove = projectGoogleAudience("remove", provider.stream.removeRowType!.parse(input));
    expect(upsert.map(x => x.identity)).toEqual(remove.map(x => x.identity));
    expect(upsert).toHaveLength(3);
  });
  it.each(["CRM_ID", "MOBILE_ADVERTISING_ID"] as const)("provisions and verifies a %s list", async identifierType => {
    let sent: any;
    const request = vi.fn(async (_url: any, init?: RequestInit) => {
      sent = JSON.parse(init!.body as string);
      return new Response(
        JSON.stringify({
          ...sent,
          name: "accountTypes/GOOGLE_ADS/accounts/1234567890/userLists/42",
          id: "42",
          accessReason: "OWNED",
        })
      );
    });
    const api = createGoogleAudienceManagement(credentials, async () => "t", request as typeof fetch);
    expect(
      await api.create(
        {
          displayName: "Test",
          integrationCode: "test-code",
          identifierType,
          appId: "com.test",
          mobilePlatform: "ANDROID",
          membershipDays: 90,
        },
        new AbortController().signal
      )
    ).toEqual({ audienceId: "42" });
    expect(sent.membershipDuration).toBe(`${90 * 86400}s`);
    expect(sent.ingestedUserListInfo.uploadKeyTypes).toEqual([identifierType === "CRM_ID" ? "USER_ID" : "MOBILE_ID"]);
  });
});
