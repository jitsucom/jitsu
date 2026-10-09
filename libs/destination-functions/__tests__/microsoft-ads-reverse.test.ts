import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { JsonObject, ReverseEtlContext, WriteBatch } from "@jitsu/protocols/reverse-etl";
import type { DestinationServices, ReverseDestinationConfig } from "@jitsu/protocols/reverse-etl-runtime";
import { createMicrosoftAdsRuntime } from "../src/functions/microsoft-ads/runtime";
import {
  MicrosoftAdsCredentials,
  MicrosoftRuntimeCredentials,
  validateMicrosoftSettings,
} from "../src/functions/microsoft-ads/meta";
import { normalizeMicrosoftAudience, normalizeMicrosoftConversion } from "../src/functions/microsoft-ads/normalize";
import { microsoftClient } from "../src/functions/microsoft-ads/client";
import { reverseDestinationMetadata } from "../src/reverse-etl/catalog";
import { createBufferedSyncStore } from "../src/reverse-etl/identity";
import { requiresManualReconciliation } from "../src/reverse-etl/failure";

const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const response = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const credentials = {
  accountId: "123",
  customerId: "456",
  oauthIntegrationId: "jitsu-cloud-dst-microsoft-ads" as const,
  oauthConnectionId: "destination.dst",
};
function fixture(managed = false, conversion = false) {
  let state: JsonObject | undefined;
  let remote: Record<string, any>[] = managed
    ? []
    : [{ Id: "789", Type: "CustomerList", Scope: "Account", ParentId: "123" }];
  const fetch = vi.fn(async (url: any, init: any) => {
    if (String(url).endsWith("/Audiences/QueryByIds")) return response({ Audiences: remote, PartialErrors: [] });
    if (String(url).endsWith("/Audiences")) {
      remote = [{ ...JSON.parse(init.body).Audiences[0], Id: "789" }];
      return response({ AudienceIds: ["789"], PartialErrors: [] });
    }
    return response({ PartialErrors: [] });
  });
  const config: ReverseDestinationConfig & { options: { mapping: Record<string, string> } } = {
    id: "sync",
    workspaceId: "ws",
    toId: "dst",
    destination: { destinationType: "microsoft-ads", ...credentials },
    model: { primaryKey: ["id"] },
    options: {
      stream: conversion ? "offline-conversions" : "audience",
      mode: managed ? "mirror" : "upsert",
      mapping: conversion ? { conversionTime: "time", email: "email" } : { email: "email" },
      streamOptions: conversion
        ? { conversionName: "Sale" }
        : {
            audience: managed ? { kind: "managed", name: "Jitsu test" } : { kind: "existing", audienceId: "789" },
            exclusiveManagementConfirmed: managed,
          },
    },
  };
  const services: DestinationServices = {
    fetch,
    signal: new AbortController().signal,
    log: vi.fn(async () => {}),
    developerToken: "developer-secret",
    getAccessToken: vi.fn(async () => "oauth-secret"),
    validateSource: vi.fn(async () => {}),
    targetState: () => ({
      read: async () => state,
      create: async value => {
        if (!state) state = structuredClone(value);
      },
      compareAndSet: async (expected, value) => {
        if (JSON.stringify(state) !== JSON.stringify(expected)) return false;
        state = structuredClone(value);
        return true;
      },
    }),
  };
  const init = async () => {
    const adapter = await createMicrosoftAdsRuntime(config, services);
    const ctx = {
      syncId: "sync",
      taskId: "task",
      logicalRunId: "run",
      configRevision: "revision",
      credentials: adapter.credentials,
      options: adapter.options,
      mode: config.options.mode,
      targetIdentity: adapter.targetIdentity,
      fullRefresh: true,
      signal: services.signal,
      fetch,
      store: createBufferedSyncStore(),
      delivery: {},
      log: {},
    } as unknown as ReverseEtlContext<JsonObject, JsonObject>;
    const writer = await adapter.stream.createWriter(ctx);
    return { adapter, ctx, writer };
  };
  return { config, services, fetch, init, state: () => state, remote: () => remote };
}
const batch = (rows: JsonObject[]): WriteBatch<JsonObject> => ({
  batchId: "batch",
  records: rows.map((row, i) => ({ key: hash(String(i)), sourceSequence: i + 1, operationId: `op${i}`, row })),
});

describe("Microsoft Ads Reverse ETL", () => {
  it("normalizes raw and hashed emails identically without removing dots or aliases", () => {
    const expected = hash("a.b+test@example.com");
    expect(normalizeMicrosoftAudience({ email: " A.B+test@Example.COM " })).toEqual({ email: expected });
    expect(normalizeMicrosoftAudience({ hashedEmail: expected.toUpperCase() })).toEqual({ email: expected });
    for (const row of [
      {},
      { email: "invalid" },
      { hashedEmail: "invalid" },
      { email: "a@b.com", hashedEmail: expected },
    ])
      expect(() => normalizeMicrosoftAudience(row)).toThrow();
  });
  it("supports identifier alternatives and optional conversion fields with deterministic UTC time", () => {
    const time = "2026-10-08T12:00:00+04:00";
    const row = normalizeMicrosoftConversion(
      {
        __sourceKey: "a".repeat(64),
        conversionTime: time,
        phone: "+1 (415) 555-2671",
        conversionValue: 0,
        currency: "usd",
      },
      "Sale",
      Date.parse("2026-10-09T00:00:00Z")
    );
    expect(row.payload).toEqual({
      ConversionName: "Sale",
      ConversionTime: "2026-10-08T08:00:00.000Z",
      HashedPhoneNumber: hash("+14155552671"),
      ConversionValue: 0,
      ConversionCurrencyCode: "USD",
    });
    for (const patch of [
      { phone: "4155552671" },
      { conversionTime: "2020-01-01T00:00:00Z" },
      { conversionTime: "2026-02-30T00:00:00Z" },
      { conversionTime: "2030-01-01T00:00:00Z" },
      { externalAttributionCredit: 0.5 },
    ])
      expect(() =>
        normalizeMicrosoftConversion(
          { __sourceKey: "a".repeat(64), conversionTime: time, phone: "+14155552671", ...patch },
          "Sale",
          Date.parse("2026-10-09T00:00:00Z")
        )
      ).toThrow();
  });
  it("keeps both stream editors isolated and validates modes and mappings", () => {
    const [audience, conversion] = reverseDestinationMetadata.get("microsoft-ads")!.streams;
    expect(audience.defaults().mode).toBe("mirror");
    expect(conversion.defaults()).toEqual({ mode: "upsert", mapping: {}, streamOptions: { conversionName: "" } });
    const f = fixture();
    expect(() => validateMicrosoftSettings(f.config.options, f.config.model, f.config.destination)).not.toThrow();
    expect(() => validateMicrosoftSettings({ ...f.config.options, stream: "unknown" }, f.config.model)).toThrow(
      "Unsupported"
    );
    expect(() => validateMicrosoftSettings({ ...f.config.options, mode: "mirror" }, f.config.model)).toThrow(
      "Existing"
    );
    expect(MicrosoftAdsCredentials.parse({ ...credentials, accountId: "9007199254740993" }).accountId).toBe(
      "9007199254740993"
    );
  });
  it("sends exact saved hashes, explicit removes and scoped credentials without following redirects", async () => {
    const f = fixture();
    const { writer } = await f.init();
    const b = batch([{ email: hash("test@example.com") }]);
    expect((await writer.upsert(b)).outcomes[0].status).toBe("accepted");
    await writer.remove!(b);
    const [url, init] = f.fetch.mock.calls.at(-1)!;
    expect(url).toContain("/CustomerListUserData/Apply");
    expect(init.redirect).toBe("error");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer oauth-secret",
      DeveloperToken: "developer-secret",
      CustomerAccountId: "123",
      CustomerId: "456",
    });
    expect(JSON.parse(init.body)).toEqual({
      CustomerListUserData: {
        ActionType: "Remove",
        AudienceId: "789",
        CustomerListItemSubType: "Email",
        CustomerListItems: [hash("test@example.com")],
      },
    });
    expect(await writer.finish()).toEqual({ delivery: "accepted" });
    const count = f.fetch.mock.calls.length;
    await writer.abort("error");
    expect(f.fetch.mock.calls.length).toBe(count);
  });
  it.each(["Account", "Customer"])("allows an accessible existing %s list owned elsewhere", async Scope => {
    const f = fixture();
    Object.assign(f.remote()[0], { Scope, ParentId: "999" });
    const { adapter, writer } = await f.init();
    expect(adapter.targetIdentity).toBe("microsoft-audience:789");
    expect(adapter.mirror).toBeUndefined();
    expect(adapter.stream.capabilities.mirror).toBe("none");
    expect(f.state()).toBeUndefined();
    expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toEqual({ Type: "CustomerList", AudienceIds: ["789"] });
    const b = batch([{ email: hash("test@example.com") }]);
    expect((await writer.upsert(b)).outcomes[0].status).toBe("accepted");
    expect((await writer.remove!(b)).outcomes[0].status).toBe("accepted");
    // Read access does not imply write access; preserve provider rejections.
    f.fetch.mockResolvedValueOnce(response({ Errors: [{ Code: 106 }] }, 403));
    expect((await writer.upsert(b)).outcomes[0]).toMatchObject({ status: "rejected", code: "MICROSOFT_106" });
  });
  it.each([
    { Audiences: [], PartialErrors: [] },
    { Audiences: [{ Id: "998", Type: "CustomerList", Scope: "Account", ParentId: "999" }], PartialErrors: [] },
    { Audiences: [{ Id: "789", Type: "RemarketingList", Scope: "Account", ParentId: "999" }], PartialErrors: [] },
    { Audiences: [null], PartialErrors: [{ Index: 0, Code: 106 }] },
  ])("rejects missing, mismatched or inaccessible existing lists: %j", async result => {
    const f = fixture();
    f.fetch.mockResolvedValueOnce(response(result));
    await expect(f.init()).rejects.toThrow();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.state()).toBeUndefined();
  });
  it.each([
    { ParentId: "999" },
    { Scope: "Customer", ParentId: credentials.customerId },
    { Description: "changed marker" },
    { MembershipDuration: 30 },
  ])("retains managed-list ownership and baseline checks: %j", async patch => {
    const f = fixture(true);
    const { adapter } = await f.init();
    Object.assign(f.remote()[0], patch);
    await expect(adapter.verifyMirrorBaseline!(f.services.signal)).rejects.toThrow("scope or ownership");
    await expect(f.init()).rejects.toThrow("scope or ownership");
    expect(f.fetch.mock.calls.filter(([url]) => String(url).endsWith("/Audiences"))).toHaveLength(1);
  });
  it("preserves indexed partial successes and never exposes provider row text", async () => {
    const f = fixture();
    const { writer } = await f.init();
    f.fetch.mockResolvedValueOnce(
      response({ PartialErrors: [{ Index: 1, Code: 123, Message: "secret-email@example.com" }] })
    );
    const result = await writer.upsert(batch([{ email: "a".repeat(64) }, { email: "b".repeat(64) }]));
    expect(result.outcomes.map(r => r.status)).toEqual(["accepted", "rejected"]);
    expect(result.submitted).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-email");
    expect(JSON.stringify(vi.mocked(f.services.log).mock.calls)).not.toContain("secret-email");
  });
  it.each([{}, { PartialErrors: [{ Index: 8, Code: 1 }] }, { PartialErrors: "bad" }])(
    "blocks malformed acknowledgements: %j",
    async value => {
      const f = fixture();
      const { writer } = await f.init();
      f.fetch.mockResolvedValueOnce(response(value));
      await expect(writer.upsert(batch([{ email: "a".repeat(64) }]))).rejects.toThrow("unconfirmed");
    }
  );
  it("uses only matching saved receipts for recovery and never replays missing receipts", async () => {
    const f = fixture();
    const { writer, adapter, ctx } = await f.init();
    const b = batch([{ email: "a".repeat(64) }]);
    const receipt = await writer.upsert(b);
    const recovery = adapter.recovery!({});
    const count = f.fetch.mock.calls.length;
    expect(await recovery.reconcileBatch!(b, "upsert", receipt, ctx)).toEqual(receipt);
    await expect(recovery.reconcileBatch!(b, "upsert", receipt, { ...ctx, logicalRunId: "other" })).rejects.toThrow(
      "unconfirmed"
    );
    try {
      await recovery.reconcileBatch!(b, "upsert", undefined, ctx);
    } catch (e) {
      expect(requiresManualReconciliation(e)).toBe(true);
    }
    expect(f.fetch.mock.calls.length).toBe(count);
  });
  it("creates managed audiences once after preflight and discovers a lost creation response", async () => {
    const f = fixture(true);
    const original = f.services.fetch;
    f.services.fetch = (async (url, init) => {
      const result = await original(url, init);
      if (String(url).endsWith("/Audiences")) throw new Error("lost response");
      return result;
    }) as typeof fetch;
    await expect(f.init()).rejects.toThrow("lost response");
    expect(f.state()?.phase).toBe("submitting");
    expect(f.services.validateSource).toHaveBeenCalledTimes(1);
    f.services.fetch = original;
    const { adapter } = await f.init();
    expect(f.fetch.mock.calls.filter(([url]) => String(url).endsWith("/Audiences"))).toHaveLength(1);
    expect(f.state()?.phase).toBe("ready");
    expect(f.remote()[0].MembershipDuration).toBe(-1);
    expect(adapter.mirror?.batchDelivery).toBe("accepted");
    expect(await adapter.verifyMirrorBaseline!(f.services.signal)).toBe("tracked");
  });
  it("does not create an audience for an invalid model", async () => {
    const f = fixture(true);
    f.services.validateSource = async () => {
      throw new Error("bad model");
    };
    await expect(f.init()).rejects.toThrow("bad model");
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.state()).toBeUndefined();
  });
  it.each(["missing-developer-token", "oauth-failure", "provider-rejection"])(
    "retries creation safely after %s",
    async kind => {
      const f = fixture(true);
      if (kind === "missing-developer-token") f.services.developerToken = undefined;
      if (kind === "oauth-failure")
        vi.mocked(f.services.getAccessToken).mockRejectedValueOnce(new Error("private refresh token"));
      if (kind === "provider-rejection") f.fetch.mockResolvedValueOnce(response({ Errors: [{ Code: 106 }] }, 403));
      await expect(f.init()).rejects.toThrow();
      expect(f.state()?.phase).toBe("prepared");
      if (kind !== "provider-rejection") expect(f.fetch).not.toHaveBeenCalled();
      f.services.developerToken = "developer-secret";
      await f.init();
      expect(f.state()?.phase).toBe("ready");
    }
  );
  it("retains unconfirmed creation when discovery has no match; never submits again", async () => {
    const f = fixture(true);
    f.fetch.mockRejectedValueOnce(new Error("timeout"));
    await expect(f.init()).rejects.toThrow();
    expect(f.state()?.phase).toBe("submitting");
    await expect(f.init()).rejects.toThrow("unconfirmed");
    expect(f.fetch.mock.calls.filter(([url]) => String(url).endsWith("/Audiences"))).toHaveLength(1);
  });
  it("refuses oversized batches and incompatible recovery bindings", async () => {
    const f = fixture();
    const { adapter, ctx, writer } = await f.init();
    const calls = f.fetch.mock.calls.length;
    await expect(writer.upsert(batch(Array.from({ length: 1001 }, () => ({ email: "a".repeat(64) }))))).rejects.toThrow(
      "batch"
    );
    await expect(adapter.recovery!({}).attachWriter({ ...ctx, targetIdentity: "other" })).rejects.toThrow("binding");
    expect(f.fetch.mock.calls.length).toBe(calls);
  });
  it("refuses a foreign OAuth binding before provider IO", async () => {
    const f = fixture();
    f.config.destination.oauthConnectionId = "destination.foreign";
    await expect(f.init()).rejects.toThrow("does not match");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("uses the distinct offline conversion operation and source-key deduplication", async () => {
    const f = fixture(false, true);
    const { adapter, writer } = await f.init();
    const row = adapter.stream.rowType.parse({
      __sourceKey: "a".repeat(64),
      conversionTime: new Date(Date.now() - 60_000).toISOString(),
      email: "test@example.com",
    });
    expect(adapter.insertOnly).toBe(true);
    expect(adapter.mirror).toBeUndefined();
    expect(writer.remove).toBeUndefined();
    expect(adapter.project("upsert", row)[0].identity).toEqual({ eventKey: "a".repeat(64) });
    await writer.upsert(batch([row]));
    expect(f.fetch.mock.calls[0][0]).toContain("/OfflineConversions/Apply");
  });
  it("redacts structured request failures and does not retry 5xx or cancellation", async () => {
    const f = fixture();
    const { writer } = await f.init();
    f.fetch.mockResolvedValueOnce(response({ Errors: [{ Code: 106, Message: "private" }] }, 403));
    expect((await writer.upsert(batch([{ email: "a".repeat(64) }]))).outcomes[0]).toMatchObject({
      status: "rejected",
      code: "MICROSOFT_106",
    });
    f.fetch.mockResolvedValueOnce(response({ Errors: [{ Code: 1 }] }, 503));
    await expect(writer.upsert(batch([{ email: "a".repeat(64) }]))).rejects.toThrow("HTTP 503");
    const count = f.fetch.mock.calls.length;
    await expect(
      microsoftClient(MicrosoftRuntimeCredentials.parse(credentials), f.services)("Audiences", {}, AbortSignal.abort())
    ).rejects.toThrow();
    expect(f.fetch.mock.calls.length).toBe(count);
  });
});
