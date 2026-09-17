import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import type { JsonObject, ReverseEtlContext, WriteBatch } from "@jitsu/protocols/reverse-etl";
import {
  createGoogleDataManager,
  googleAudienceTargetIdentity,
  projectGoogleAudience,
} from "../src/functions/google-ads-reverse";
import { googleAudienceMetadata } from "../src/functions/google-ads-reverse/meta";
import { createBufferedSyncStore } from "../src/reverse-etl/identity";
import { validateReverseEtlConfig } from "../src/reverse-etl/meta";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const consent = { adUserData: "GRANTED", adPersonalization: "GRANTED" };
const credentials = {
  authorized: true,
  oauthConnectionId: "destination.dst",
  customerId: "123-456-7890",
  loginCustomerId: "9876543210",
};
const options = { audienceId: "1234", customerMatchTermsAccepted: true };
const destination = {
  operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
  loginAccount: { accountType: "GOOGLE_ADS", accountId: "9876543210" },
  productDestinationId: "1234",
};
function fixture() {
  const token = vi.fn(async () => "private-token");
  const provider = createGoogleDataManager(token);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ requestId: "request-1" })));
  const ctx = {
    syncId: "s",
    taskId: "t",
    logicalRunId: "r",
    configRevision: "a".repeat(64),
    targetIdentity: googleAudienceTargetIdentity(credentials, options),
    mode: "upsert",
    fullRefresh: true,
    credentials,
    options,
    signal: new AbortController().signal,
    fetch,
    store: createBufferedSyncStore(),
    delivery: {},
    log: { info() {}, error() {}, warn() {}, debug() {} },
  } as unknown as ReverseEtlContext<JsonObject, JsonObject>;
  const batch: WriteBatch<JsonObject> = {
    batchId: "b",
    records: [
      {
        key: "k",
        operationId: "op",
        sourceSequence: 1,
        row: provider.stream.rowType.parse({ email: " A.Lice+tag@Gmail.com ", ...consent }),
      },
    ],
  };
  const status = (requestStatus: string, extra: JsonObject = {}) =>
    fetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            requestStatusPerDestination: [
              {
                destination,
                requestStatus,
                audienceMembersIngestionStatus: { userDataIngestionStatus: { recordCount: "1" } },
                ...extra,
              },
            ],
          })
        )
    );
  return { ...provider, ctx, fetch, token, batch, status };
}
describe("Google Data Manager audience adapter", () => {
  it("normalizes raw identifiers once and preserves pre-hashed identifiers", () => {
    const { stream } = fixture();
    const raw = stream.rowType.parse({ email: " A.Lice+tag@Gmail.com ", phone: "+1 (800) 555-0100", ...consent });
    const hashed = stream.rowType.parse({
      hashedEmail: sha("alice@gmail.com").toUpperCase(),
      hashedPhone: sha("+18005550100"),
      ...consent,
    });
    expect(raw).toEqual(hashed);
    expect(raw).toEqual({
      userData: { userIdentifiers: [{ emailAddress: sha("alice@gmail.com") }, { phoneNumber: sha("+18005550100") }] },
      consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
    });
    expect(stream.rowType.parse({ email: "User.Name+NYC@Example.com", ...consent })).toMatchObject({
      userData: { userIdentifiers: [{ emailAddress: sha("user.name+nyc@example.com") }] },
    });
    expect(stream.rowType.parse({ email: "a.b+x@googlemail.com", ...consent })).toMatchObject({
      userData: { userIdentifiers: [{ emailAddress: sha("ab@googlemail.com") }] },
    });
  });
  it.each([
    {},
    { email: null },
    { phone: "8005550100" },
    { phone: "+0000000000" },
    { phone: "+1234567890123456" },
    { email: "no-at" },
    { hashedEmail: "bad" },
    { email: "a@b.com", hashedEmail: "a".repeat(64) },
    { email: "a@b.com", adUserData: "DENIED" },
    { email: "a@b.com", adPersonalization: undefined },
  ])("rejects invalid or unconsented source rows before delivery: %j", row => {
    expect(fixture().stream.rowType.safeParse({ ...consent, ...row }).success).toBe(false);
  });
  it("removes denied-consent members without sending consent or re-hashing", async () => {
    const f = fixture();
    f.batch.records[0].row = f.stream.removeRowType!.parse({ hashedEmail: "A".repeat(64), adUserData: "DENIED" });
    const writer = await f.stream.createWriter(f.ctx);
    await writer.remove!(f.batch);
    const [url, init] = (f.fetch.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toContain("audienceMembers:remove");
    expect(JSON.parse(init.body as string)).toEqual({
      destinations: [destination],
      encoding: "HEX",
      audienceMembers: [{ userData: { userIdentifiers: [{ emailAddress: "a".repeat(64) }] } }],
    });
  });
  it("projects shared identifier collisions independently of source keys/grouping", () => {
    const f = fixture();
    const a = projectGoogleAudience("upsert", f.batch.records[0].row);
    const b = projectGoogleAudience(
      "remove",
      f.stream.removeRowType!.parse({ email: "alice@gmail.com", phone: "+18005550100" })
    );
    expect(a[0].identity).toEqual(b[0].identity);
    expect(a[0].remove).toEqual(b[0].remove);
  });
  it("stages then polls exact receipts without resending, and treats finish as local only", async () => {
    const f = fixture();
    const writer = await f.stream.createWriter(f.ctx);
    await writer.init();
    const saved = await writer.upsert(f.batch);
    expect(saved.outcomes).toEqual([{ operationId: "op", status: "staged" }]);
    expect(saved.remoteJobIds).toEqual(["request-1"]);
    const [url, init] = (f.fetch.mock.calls as unknown as [string, RequestInit][])[0];
    expect(url).toContain("audienceMembers:ingest");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toEqual({
      destinations: [destination],
      encoding: "HEX",
      audienceMembers: [f.batch.records[0].row],
      termsOfService: { customerMatchTermsOfServiceStatus: "ACCEPTED" },
    });
    expect(JSON.stringify(saved)).not.toContain("private-token");
    f.status("PROCESSING");
    expect(await f.recovery.reconcileBatch(f.batch, "upsert", saved, f.ctx)).toBe(saved);
    f.status("SUCCESS");
    expect((await f.recovery.reconcileBatch(f.batch, "upsert", saved, f.ctx)).outcomes).toEqual([
      { operationId: "op", status: "accepted" },
    ]);
    expect(await writer.finish()).toEqual({ delivery: "accepted" });
    await writer.abort("error");
    expect(f.fetch).toHaveBeenCalledTimes(3);
    expect(
      (f.fetch.mock.calls as unknown as [string, RequestInit][]).slice(1).every(([, init]) => init.method === "GET")
    ).toBe(true);
  });
  it("uses removal statistics for removal acceptance", async () => {
    const f = fixture();
    f.batch.records[0].row = f.stream.removeRowType!.parse({ email: "a@b.com" });
    const saved = await (await f.stream.createWriter(f.ctx)).remove!(f.batch);
    f.fetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            requestStatusPerDestination: [
              {
                destination,
                requestStatus: "SUCCESS",
                audienceMembersRemovalStatus: { userDataRemovalStatus: { recordCount: "1" } },
              },
            ],
          })
        )
    );
    expect((await f.recovery.reconcileBatch(f.batch, "remove", saved, f.ctx)).outcomes[0].status).toBe("accepted");
  });
  it("rejects every row only when Google reports whole-request FAILED", async () => {
    const f = fixture();
    const saved = await (await f.stream.createWriter(f.ctx)).upsert(f.batch);
    f.status("FAILED", { errorInfo: { errorCounts: [{ recordCount: "1", reason: "private-provider-text" }] } });
    const result = await f.recovery.reconcileBatch(f.batch, "upsert", saved, f.ctx);
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", code: "GOOGLE_REQUEST_FAILED" });
    expect(JSON.stringify(result)).not.toContain("private-provider-text");
  });
  it.each([
    ["PARTIAL_SUCCESS", {}],
    ["FUTURE_STATUS", {}],
    ["SUCCESS", { warningInfo: { warningCounts: [{ recordCount: "1" }] } }],
    ["SUCCESS", { audienceMembersIngestionStatus: { userDataIngestionStatus: { recordCount: "0" } } }],
    ["SUCCESS", { destination: { ...destination, productDestinationId: "999" } }],
  ])("blocks ambiguous results without guessing per-row outcomes: %s", async (status, extra) => {
    const f = fixture();
    const saved = await (await f.stream.createWriter(f.ctx)).upsert(f.batch);
    f.status(status, extra);
    await expect(f.recovery.reconcileBatch(f.batch, "upsert", saved, f.ctx)).rejects.toThrow();
    expect(saved.outcomes[0].status).toBe("staged");
  });
  it("persists submission warnings with request ID and never silently accepts them", async () => {
    const f = fixture();
    f.fetch.mockImplementation(
      async () => new Response(JSON.stringify({ requestId: "request-1", fieldWarnings: [{ message: "private" }] }))
    );
    const saved = await (await f.stream.createWriter(f.ctx)).upsert(f.batch);
    expect(saved.providerCheckpoint?.submissionWarnings).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("private");
    f.status("SUCCESS");
    await expect(f.recovery.reconcileBatch(f.batch, "upsert", saved, f.ctx)).rejects.toThrow("unverified");
  });
  it("requires a bound receipt before any recovery HTTP request", async () => {
    const f = fixture();
    await expect(f.recovery.reconcileBatch(f.batch, "upsert", undefined, f.ctx)).rejects.toThrow("no automatic replay");
    expect(f.fetch).not.toHaveBeenCalled();
    const saved = await (await f.stream.createWriter(f.ctx)).upsert(f.batch);
    await expect(
      f.recovery.reconcileBatch(f.batch, "upsert", saved, { ...f.ctx, configRevision: "other" })
    ).rejects.toThrow("does not match");
    f.batch.records[0].row = f.stream.rowType.parse({ email: "different@example.com", ...consent });
    await expect(f.recovery.reconcileBatch(f.batch, "upsert", saved, f.ctx)).rejects.toThrow("does not match");
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 429, 500])("does not retry failed POST (%s) or expose the response", async status => {
    const f = fixture();
    f.fetch.mockImplementation(async () => new Response("private-token, email", { status }));
    await expect((await f.stream.createWriter(f.ctx)).upsert(f.batch)).rejects.toThrow("preserve recovery evidence");
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("records definite non-submission when OAuth fails before Google I/O", async () => {
    const f = fixture();
    f.token.mockRejectedValue(new Error("private-token"));
    const result = await (await f.stream.createWriter(f.ctx)).upsert(f.batch);
    expect(result.outcomes).toEqual([
      {
        operationId: "op",
        status: "rejected",
        code: "GOOGLE_AUTH_UNAVAILABLE",
        safeReason: "OAuth unavailable; no Google request was submitted",
      },
    ]);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
  it("does not replay lost request IDs or send after cancellation", async () => {
    const f = fixture();
    f.fetch.mockImplementation(async () => new Response("{}"));
    await expect((await f.stream.createWriter(f.ctx)).upsert(f.batch)).rejects.toThrow("manual reconciliation");
    const ctx = { ...f.ctx, signal: AbortSignal.abort() };
    await expect((await f.stream.createWriter(ctx)).upsert(f.batch)).rejects.toThrow();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("advertises mirroring but requires managed evidence at runtime", async () => {
    expect(() =>
      validateReverseEtlConfig(googleAudienceMetadata, {
        mode: "mirror",
        mapping: { email: "id", adUserData: "c", adPersonalization: "c" },
        columns: ["id", "c"],
        options,
      })
    ).not.toThrow();
    expect(fixture().stream.capabilities.mirror).toBe("none");
    const f = fixture();
    await expect(f.stream.createWriter({ ...f.ctx, mode: "mirror" })).rejects.toThrow();
    const managed = {
      id: `retl-google-${"a".repeat(64)}`,
      syncId: "s",
      customerId: "1234567890",
      audienceId: "1234",
      integrationCode: `jitsu-retl-${"a".repeat(64)}`,
      displayName: "Managed",
      membershipDays: 540 as const,
    };
    const google = createGoogleDataManager(f.token, managed);
    const writer = await google.mirrorStream.createWriter({
      ...f.ctx,
      mode: "mirror",
      options: { ...options, managedAudienceId: managed.id },
    });
    const wire = google.mirrorStream.rowType.parse(f.batch.records[0].row);
    expect(wire).toEqual(f.batch.records[0].row);
    await writer.upsert(f.batch);
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
