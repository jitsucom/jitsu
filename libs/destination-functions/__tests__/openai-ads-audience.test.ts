import { describe, expect, it, vi } from "vitest";
import type { BatchResult, JsonObject, ReverseEtlContext, WriteBatch } from "@jitsu/protocols/reverse-etl";
import type { DestinationServices, ReverseDestinationConfig } from "@jitsu/protocols/reverse-etl-runtime";
import { createOpenAiAdsRuntime } from "../src/functions/openai-ads/runtime";
import { normalizeOpenAiAudience, openAiAudienceWire } from "../src/functions/openai-ads/audience";
import { OpenAiAudienceUnusable, OpenAiWaitTimeout } from "../src/functions/openai-ads/audience-api";
import { OpenAiTransportError } from "../src/functions/openai-ads/client";
import { OpenAiUncertainDelivery } from "../src/functions/openai-ads/delivery";
import { openAiAudienceStateStream } from "../src/functions/openai-ads/reverse-meta";
import { createBufferedSyncStore } from "../src/reverse-etl/identity";
import { validateBatchResult } from "../src/reverse-etl/meta";
import { reverseEtlFailure } from "../src/reverse-etl/failure";
import { audienceId, fakeAds, hash, json, memoryTargetState, refusal } from "./lib/openai-ads-fake";
import { createHash } from "node:crypto";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const managed = {
  stream: "audience",
  mode: "mirror" as const,
  streamOptions: { audience: { kind: "managed", name: "My audience" }, exclusiveManagementConfirmed: true },
};

function setup(options: ReverseDestinationConfig["options"] = managed, destination: Record<string, unknown> = {}) {
  const ads = fakeAds();
  const store = memoryTargetState();
  const log = vi.fn(async (_message: string) => {});
  const config: ReverseDestinationConfig = {
    id: "sync",
    workspaceId: "ws",
    toId: "dst",
    destination: { destinationType: "openai-ads", adsApiKey: "ads-key", ...destination },
    model: {},
    options,
  };
  const services = (fetch = ads.fetch): DestinationServices =>
    ({
      fetch,
      signal: new AbortController().signal,
      log,
      getAccessToken: async () => "",
      targetState: () => store.state,
    } as unknown as DestinationServices);
  const build = (fetch = ads.fetch) => createOpenAiAdsRuntime(config, services(fetch), ads.wait);
  const context = (adapter: Awaited<ReturnType<typeof build>>, fetch = ads.fetch) =>
    ({
      mode: config.options.mode,
      fullRefresh: false,
      syncId: "sync",
      taskId: "task",
      logicalRunId: "run",
      configRevision: "rev",
      targetIdentity: adapter.targetIdentity,
      credentials: adapter.credentials,
      options: adapter.stream.options.parse(config.options.streamOptions),
      signal: new AbortController().signal,
      log: { info() {}, warn() {}, error() {}, debug() {} },
      fetch,
      store: createBufferedSyncStore(),
      delivery: {},
    } as unknown as ReverseEtlContext<JsonObject, JsonObject>);
  return { ads, store, log, config, services, build, context };
}
const member = (n: number, extra: Record<string, unknown> = {}) =>
  normalizeOpenAiAudience({ email: `m${n}@example.com`, ...extra });
function batch(rows: JsonObject[], id = "batch-1"): WriteBatch<JsonObject> {
  return {
    batchId: id,
    records: rows.map((row, i) => ({ key: sha(`k${i}`), sourceSequence: i + 1, operationId: `op-${i}`, row })),
  };
}
const adds = (ads: ReturnType<typeof fakeAds>) => [...ads.operations.values()];

describe("OpenAI audience provisioning", () => {
  it("creates the managed audience once, saves its marker, waits for ready, and reuses it on the next run", async () => {
    const t = setup();
    const adapter = await t.build();
    expect(t.ads.log.filter(l => l === "POST /custom_audiences")).toHaveLength(1);
    expect(t.ads.time()).toBeGreaterThanOrEqual(17_000);
    expect(adapter.targetIdentity).toBe(`openai-audience:adacct_test:${audienceId(1)}`);
    expect(t.store.get()).toMatchObject({
      version: 1,
      phase: "ready",
      audienceId: audienceId(1),
      accountId: "adacct_test",
    });
    expect(String(t.store.get()!.marker)).toMatch(/^jitsu-retl-[a-f0-9]{64}$/);
    expect(t.ads.audiences.get(audienceId(1))!.description).toContain(String(t.store.get()!.marker));
    expect(t.ads.audiences.get(audienceId(1))!.name).toBe("My audience");
    await t.build();
    expect(t.ads.log.filter(l => l === "POST /custom_audiences")).toHaveLength(1);
  });
  it("finds the audience by its marker after a lost create answer instead of creating a second one", async () => {
    const t = setup();
    const lossy: typeof t.ads.fetch = async (url, init) => {
      const response = await t.ads.fetch(url, init);
      if (init.method === "POST" && url.endsWith("/custom_audiences")) throw new Error("socket hang up");
      return response;
    };
    await expect(t.build(lossy)).rejects.toBeInstanceOf(OpenAiTransportError);
    expect(t.ads.audiences.size).toBe(1);
    expect(t.store.get()).toMatchObject({ phase: "submitting" });
    const adapter = await t.build();
    expect(t.ads.audiences.size).toBe(1);
    expect(adapter.targetIdentity).toBe(`openai-audience:adacct_test:${audienceId(1)}`);
    expect(t.store.get()).toMatchObject({ phase: "ready", audienceId: audienceId(1) });
  });
  it("stops with a clear message when discovery cannot account for the audience", async () => {
    const t = setup();
    await t.build();
    const saved = t.store.get()!;
    const { audienceId: _created, ...withoutAudience } = saved;
    t.store.set({ ...withoutAudience, phase: "submitting" });
    t.ads.audiences.get(audienceId(1))!.description = "edited by someone";
    await expect(t.build()).rejects.toThrow(
      "OpenAI audience creation is unconfirmed; retry discovery without resetting state"
    );
    expect(t.ads.audiences.size).toBe(1);
  });
  it("returns to the prepared state after a definite refusal so the same intent can be retried", async () => {
    const t = setup();
    let refuse = true;
    const fetch: typeof t.ads.fetch = async (url, init) =>
      refuse && init.method === "POST" && url.endsWith("/custom_audiences")
        ? refusal(403, "permission_denied")
        : t.ads.fetch(url, init);
    await expect(t.build(fetch)).rejects.toMatchObject({ status: 403, rejected: true });
    expect(t.store.get()).toMatchObject({ phase: "prepared" });
    expect(t.ads.audiences.size).toBe(0);
    refuse = false;
    await t.build(fetch);
    expect(t.ads.audiences.size).toBe(1);
  });
  it("refuses an audience that belongs to another ad account or no longer carries the marker", async () => {
    const t = setup();
    await t.build();
    const other: typeof t.ads.fetch = async (url, init) =>
      url.endsWith("/ad_account") ? json({ id: "adacct_other" }) : t.ads.fetch(url, init);
    await expect(t.build(other)).rejects.toThrow(
      "OpenAI audience does not match the saved account or ownership marker"
    );
    t.ads.audiences.get(audienceId(1))!.description = "no marker";
    await expect(t.build()).rejects.toThrow("OpenAI audience does not match the saved account or ownership marker");
  });
  it("refuses saved state created for different settings", async () => {
    const t = setup();
    await t.build();
    const other = {
      ...t.config,
      options: {
        ...managed,
        streamOptions: { ...managed.streamOptions, audience: { kind: "managed", name: "Another" } },
      },
    };
    await expect(createOpenAiAdsRuntime(other, t.services(), t.ads.wait)).rejects.toThrow(
      "OpenAI audience settings differ from saved provisioning state; do not reset"
    );
  });
  it("uses an existing audience for additions and removals only, without a mirror or saved state", async () => {
    const created = setup();
    await created.build();
    const t = setup({
      stream: "audience",
      mode: "upsert",
      streamOptions: { audience: { kind: "existing", audienceId: audienceId(1) } },
    });
    t.ads.audiences.set(audienceId(1), { created: -60_000, description: "someone's audience", name: "n", revision: 0 });
    const adapter = await t.build();
    expect(adapter.targetIdentity).toBe(`openai-audience:adacct_test:${audienceId(1)}`);
    expect(adapter.mirror).toBeUndefined();
    expect(adapter.stream.capabilities).toMatchObject({
      mirror: "none",
      replay: "idempotency-key",
      supportsExplicitRemove: true,
    });
    expect(t.store.get()).toBeUndefined();
    expect(t.ads.log.filter(l => l === "POST /custom_audiences")).toHaveLength(0);
  });
  it("needs the Ads API key, not only a Conversions API key", async () => {
    const t = setup(managed, { adsApiKey: undefined, conversionsApiKey: "conv-key" });
    await expect(t.build()).rejects.toThrow("Add the Ads API key to this OpenAI Ads destination.");
  });
});

describe("OpenAI audience delivery", () => {
  it("sends one Add per batch with every identifier, under a key derived from the batch, and applies a replay once", async () => {
    const t = setup();
    const adapter = await t.build();
    const ctx = t.context(adapter);
    const writer = await adapter.stream.createWriter(ctx);
    const rows = [member(1, { phone: "+12025550124" }), member(2)];
    const first = await writer.upsert(batch(rows));
    expect(first.outcomes.map(o => o.status)).toEqual(["accepted", "accepted"]);
    expect(first.submitted).toBe(true);
    expect(() => validateBatchResult(batch(rows), first)).not.toThrow();
    const [op] = adds(t.ads);
    expect(op.action).toBe("add");
    expect(op.key).toMatch(/^jitsu-[a-f0-9]{64}$/);
    expect(JSON.parse(op.body).identifiers).toEqual([
      { identifier_type: "email_sha256", identifier: sha("m1@example.com") },
      { identifier_type: "phone_number_sha256", identifier: sha("+12025550124") },
      { identifier_type: "email_sha256", identifier: sha("m2@example.com") },
    ]);
    // The same batch again (a restart) carries the same key, so OpenAI returns the first operation.
    const again = await writer.upsert(batch(rows));
    expect(again.outcomes.map(o => o.status)).toEqual(["accepted", "accepted"]);
    expect(adds(t.ads)).toHaveLength(1);
    // A different batch gets a different key.
    await writer.upsert(batch([member(3)], "batch-2"));
    expect(adds(t.ads)).toHaveLength(2);
    expect(new Set(adds(t.ads).map(o => o.key)).size).toBe(2);
  });
  it("removes with every identifier of the member, as an Add sends them", async () => {
    // An existing audience removes the rows the model marks deleted, parsed by the stream's own remove row type.
    const t = setup({
      stream: "audience",
      mode: "upsert",
      streamOptions: { audience: { kind: "existing", audienceId: audienceId(1) } },
    });
    t.ads.audiences.set(audienceId(1), { created: -60_000, description: "someone's audience", name: "n", revision: 0 });
    const adapter = await t.build();
    const writer = await adapter.stream.createWriter(t.context(adapter));
    const removal = adapter.stream.removeRowType!.parse({
      email: "M1@example.com",
      phone: "+12025550124",
    }) as JsonObject;
    const result = await writer.remove!(batch([removal]));
    expect(result.outcomes[0].status).toBe("accepted");
    const [op] = adds(t.ads);
    expect(op.action).toBe("remove");
    expect(JSON.parse(op.body).identifiers).toEqual([
      { identifier_type: "email_sha256", identifier: sha("m1@example.com") },
      { identifier_type: "phone_number_sha256", identifier: sha("+12025550124") },
    ]);
  });
  it("rejects the batch when OpenAI reports the operation failed, with a controlled code and no provider text", async () => {
    for (const [code, expected] of [
      ["audience_too_small_for_campaign", "OPENAI_AUDIENCE_TOO_SMALL_FOR_CAMPAIGN"],
      ["Contains Private Value!", "OPENAI_OPERATION_FAILED"],
      [undefined, "OPENAI_OPERATION_FAILED"],
    ] as const) {
      const t = setup();
      const adapter = await t.build();
      const writer = await adapter.stream.createWriter(t.context(adapter));
      t.ads.hooks.operationStatus = () =>
        json({
          operation_id: "caudop_1",
          custom_audience_id: "caud_1",
          operation: "add",
          status: "failed",
          failure_reason: { code, message: "private detail m1@example.com" },
        });
      const result = await writer.upsert(batch([member(1)]));
      expect(result.outcomes.every(o => o.status === "rejected" && (o as any).code === expected)).toBe(true);
      expect(result.submitted).toBe(true);
      expect(JSON.stringify(result)).not.toContain("private detail");
      expect(JSON.stringify(t.log.mock.calls)).not.toContain("private detail");
    }
  });
  it("rejects the batch on a definite refusal at submit and keeps the provider message out", async () => {
    const t = setup();
    const adapter = await t.build();
    const writer = await adapter.stream.createWriter(t.context(adapter));
    t.ads.hooks.intercept = route =>
      route.endsWith("/add")
        ? json(
            {
              error: {
                message: "private detail",
                type: "invalid_request_error",
                param: "identifiers[0]",
                code: "custom_audience_operation_invalid",
              },
            },
            422
          )
        : undefined;
    const result = await writer.upsert(batch([member(1)]));
    expect(result.outcomes[0]).toMatchObject({ status: "rejected", code: "OPENAI_CUSTOM_AUDIENCE_OPERATION_INVALID" });
    expect(JSON.stringify(result)).not.toContain("private detail");
    expect(adds(t.ads)).toHaveLength(0);
  });
  it("does not read Cloudflare's plain-text 403 as a rejection: the call throws for recovery", async () => {
    const t = setup();
    const adapter = await t.build();
    const writer = await adapter.stream.createWriter(t.context(adapter));
    t.ads.hooks.intercept = route =>
      route.endsWith("/add") ? new Response("error code: 1010\n", { status: 403 }) : undefined;
    await expect(writer.upsert(batch([member(1)]))).rejects.toMatchObject({ status: 403, rejected: false });
  });
  it("does not read an error while waiting for an accepted operation as a rejection: it throws and recovery replays", async () => {
    const t = setup();
    const adapter = await t.build();
    const writer = await adapter.stream.createWriter(t.context(adapter));
    for (const status of [401, 403, 404]) {
      t.ads.hooks.operationCalls = 0;
      t.ads.hooks.operationStatus = calls => (calls === 1 ? refusal(status, "access_denied") : "");
      const rows = [member(status)];
      await expect(writer.upsert(batch(rows, `batch-${status}`))).rejects.toMatchObject({ status });
      const opsBefore = adds(t.ads).length;
      // Access is back: recovery replays the same key and the same operation is accepted, nothing applied twice.
      const recovery = adapter.recovery!({});
      const result = await recovery.reconcileBatch!(
        batch(rows, `batch-${status}`),
        "upsert",
        undefined,
        t.context(adapter)
      );
      expect(result.outcomes.map(o => o.status)).toEqual(["accepted"]);
      expect(adds(t.ads)).toHaveLength(opsBefore);
    }
  });
  it("recovers a lost submit answer by replaying the same key: applied once, accepted", async () => {
    const t = setup();
    const adapter = await t.build();
    const lossy: typeof t.ads.fetch = async (url, init) => {
      const response = await t.ads.fetch(url, init);
      if (url.endsWith("/add")) throw new Error("socket hang up");
      return response;
    };
    const rows = [member(1), member(2)];
    const writer = await adapter.stream.createWriter(t.context(adapter, lossy));
    await expect(writer.upsert(batch(rows))).rejects.toBeInstanceOf(OpenAiTransportError);
    expect(adds(t.ads)).toHaveLength(1);
    const recovery = adapter.recovery!({});
    const result = await recovery.reconcileBatch!(batch(rows), "upsert", undefined, t.context(adapter));
    expect(result.outcomes.map(o => o.status)).toEqual(["accepted", "accepted"]);
    expect(adds(t.ads)).toHaveLength(1);
  });
  it("recovers an operation that was still running when the wait ran out", async () => {
    const t = setup();
    const adapter = await t.build();
    const rows = [member(1)];
    const writer = await adapter.stream.createWriter(t.context(adapter));
    t.ads.hooks.operationStatus = () => "processing";
    await expect(writer.upsert(batch(rows))).rejects.toBeInstanceOf(OpenAiWaitTimeout);
    t.ads.hooks.operationStatus = undefined;
    const result = await adapter.recovery!({}).reconcileBatch!(batch(rows), "upsert", undefined, t.context(adapter));
    expect(result.outcomes[0].status).toBe("accepted");
    expect(adds(t.ads)).toHaveLength(1);
  });
  it("returns a saved receipt without calling OpenAI, and refuses one bound to another batch", async () => {
    const t = setup();
    const adapter = await t.build();
    const ctx = t.context(adapter);
    const rows = [member(1)];
    const writer = await adapter.stream.createWriter(ctx);
    const saved = (await writer.upsert(batch(rows))) as BatchResult;
    const before = t.ads.log.length;
    const recovery = adapter.recovery!({});
    expect(await recovery.reconcileBatch!(batch(rows), "upsert", saved, ctx)).toEqual(saved);
    expect(t.ads.log.length).toBe(before);
    await expect(recovery.reconcileBatch!(batch([member(9)], "other"), "upsert", saved, ctx)).rejects.toBeInstanceOf(
      OpenAiUncertainDelivery
    );
  });
  it("binds a writer to its target, options and credentials", async () => {
    const t = setup();
    const adapter = await t.build();
    const wrong = {
      ...t.context(adapter),
      targetIdentity: `openai-audience:adacct_test:${audienceId(99)}`,
    } as ReverseEtlContext<JsonObject, JsonObject>;
    await expect(adapter.stream.createWriter(wrong)).rejects.toThrow("OpenAI writer binding does not match");
  });
  it("limits a batch to 3,000 members and never sends an empty one", async () => {
    const t = setup();
    const adapter = await t.build();
    const writer = await adapter.stream.createWriter(t.context(adapter));
    await expect(writer.upsert(batch([]))).rejects.toThrow("Invalid OpenAI audience batch size");
    await expect(writer.upsert(batch(Array.from({ length: 3001 }, (_, i) => member(i))))).rejects.toThrow(
      "Invalid OpenAI audience batch size"
    );
    expect(adds(t.ads)).toHaveLength(0);
  });
});

describe("OpenAI audience mirror contract", () => {
  it("declares snapshot-diff mirroring, accepted-batch delivery and the idempotency-key replay contract", async () => {
    const t = setup();
    const adapter = await t.build();
    expect(adapter.stream.capabilities).toEqual({
      supportsUpsert: true,
      supportsExplicitRemove: true,
      mirror: "snapshot-diff",
      replay: "idempotency-key",
    });
    expect(adapter.mirror?.batchDelivery).toBe("accepted");
    expect(adapter.stream.batchSize).toBe(3000);
    expect(await adapter.verifyMirrorBaseline!(new AbortController().signal)).toBe("tracked");
    t.ads.audiences.get(audienceId(1))!.description = "no marker";
    await expect(adapter.verifyMirrorBaseline!(new AbortController().signal)).rejects.toThrow("ownership marker");
  });
  it("identifies a member by one identifier, and a removal carries every identifier the member was added with", async () => {
    const t = setup();
    const adapter = await t.build();
    const project = adapter.mirror!.projection;
    const raw = project.rowType.parse({ email: "Jamie@Example.com", phone: "+12025550124" });
    const [effect] = project.project(raw);
    expect(effect.identity).toEqual({ email_sha256: sha("jamie@example.com") });
    expect(openAiAudienceWire.parse(effect.upsert).identifiers.map(i => i.identifier_type)).toEqual([
      "email_sha256",
      "phone_number_sha256",
    ]);
    expect(effect.remove).toEqual(effect.upsert);
    expect(openAiAudienceWire.parse(effect.remove).identifiers.map(i => i.identifier_type)).toEqual([
      "email_sha256",
      "phone_number_sha256",
    ]);
    // The same person with another phone has the same identity, and the removal carries that phone.
    const [other] = project.project(project.rowType.parse({ email: "jamie@example.com", phone: "+12025550199" }));
    expect(other.identity).toEqual(effect.identity);
    expect(openAiAudienceWire.parse(other.remove).identifiers[1].identifier).toBe(sha("+12025550199"));
    // Without an email the phone is the identity; without either, the GAID.
    expect(project.project(project.rowType.parse({ phone: "+12025550124" }))[0].identity).toEqual({
      phone_number_sha256: sha("+12025550124"),
    });
    expect(
      project.project(project.rowType.parse({ gaid: "38400000-8cf0-11bd-b23e-10b96e40000d" }))[0].identity
    ).toEqual({
      gaid: "38400000-8cf0-11bd-b23e-10b96e40000d",
    });
  });
  it("refuses a row with no usable identifier instead of dropping it", async () => {
    const t = setup();
    const adapter = await t.build();
    expect(() => adapter.stream.rowType.parse({})).toThrow();
    expect(() => adapter.stream.rowType.parse({ email: "not-an-email" })).toThrow();
    expect(() => adapter.mirror!.projection.rowType.parse({ unknown: "x" })).toThrow();
  });
  it("never hashes twice: wire rows carry only hashes and the GAID", async () => {
    const t = setup();
    const adapter = await t.build();
    const wire = adapter.mirror!.projection.rowType.parse({
      email: "Jamie@Example.com",
      phone: "+1 (202) 555-0124",
      gaid: "38400000-8CF0-11BD-B23E-10B96E40000D",
    });
    expect(JSON.stringify(wire)).not.toContain("jamie");
    expect(JSON.stringify(wire)).not.toContain("202");
    expect(JSON.stringify(wire)).toContain("38400000-8cf0-11bd-b23e-10b96e40000d");
    expect(hash(1)).toHaveLength(64);
  });
});

describe("OpenAI audience failure messages", () => {
  it("gives every refusal the run can raise before or between batches an actionable message", async () => {
    const thrown: Error[] = [new OpenAiAudienceUnusable("archived"), new OpenAiWaitTimeout("audience")];
    // Provisioning: an unconfirmed create, changed settings, another account, and a missing key.
    const lostCreate = setup();
    const lossy: typeof lostCreate.ads.fetch = async (url, init) => {
      const response = await lostCreate.ads.fetch(url, init);
      if (init.method === "POST" && url.endsWith("/custom_audiences")) throw new Error("socket hang up");
      return response;
    };
    await lostCreate.build(lossy).catch(() => {});
    lostCreate.ads.audiences.get(audienceId(1))!.description = "edited";
    thrown.push(await lostCreate.build().catch(e => e));
    const t = setup();
    await t.build();
    thrown.push(
      await createOpenAiAdsRuntime(
        {
          ...t.config,
          options: {
            ...managed,
            streamOptions: { ...managed.streamOptions, audience: { kind: "managed", name: "Other" } },
          },
        },
        t.services(),
        t.ads.wait
      ).catch(e => e)
    );
    t.ads.audiences.get(audienceId(1))!.description = "no marker";
    thrown.push(await t.build().catch(e => e));
    thrown.push(
      await setup(managed, { adsApiKey: undefined })
        .build()
        .catch(e => e)
    );
    for (const reason of ["identifier", "noIdentifier"] as const)
      thrown.push(
        await Promise.resolve()
          .then(() => normalizeOpenAiAudience(reason === "identifier" ? { email: "x" } : {}))
          .catch(e => e)
      );
    const unexplained = thrown.filter(e => !reverseEtlFailure(e)).map(e => e.message);
    expect(unexplained).toEqual([]);
    expect(thrown.filter(e => reverseEtlFailure(e)).length).toBeGreaterThanOrEqual(7);
    for (const e of thrown) {
      const failure = reverseEtlFailure(e);
      if (failure) {
        expect(failure.message).not.toMatch(/caud_|adacct_|@example/);
      }
    }
  });
});
