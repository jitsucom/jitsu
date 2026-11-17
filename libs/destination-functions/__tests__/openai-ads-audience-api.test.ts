import { describe, expect, it } from "vitest";
import { OpenAiApiError, OpenAiTransportError } from "../src/functions/openai-ads/client";
import { OpenAiAdsCall, OpenAiAdsFetch, OpenAiWait } from "../src/functions/openai-ads/ads-client";
import {
  OpenAiAudienceUnusable,
  OpenAiWaitTimeout,
  adAccountId,
  createAudience,
  findAudiencesByMarker,
  getAudience,
  submitMembership,
  waitForAudienceReady,
  waitForOperation,
} from "../src/functions/openai-ads/audience-api";

import { audienceId, fakeAds, hash, ids, json, refusal } from "./lib/openai-ads-fake";

describe("OpenAI audience API layer", () => {
  it("reads the ad account id", async () => {
    expect(await adAccountId(fakeAds().call())).toBe("adacct_test");
  });
  it("creates an empty audience and waits for it to be ready, treating unknown statuses as not finished", async () => {
    const ads = fakeAds();
    const created = await createAudience(ads.call(), { name: "jitsu test", description: "marker" });
    expect(created.status).toBe("rockset_ingest_pending");
    const ready = await waitForAudienceReady(ads.call(), created.id, { wait: ads.wait });
    expect(ready.status).toBe("ready");
    // Polls grow 1 s, 1.5 s, ... so the clock stops just after the 17 s mark, not at a fixed interval.
    expect(ads.time()).toBeGreaterThanOrEqual(17_000);
    expect(ads.time()).toBeLessThan(30_000);
  });
  it("fails clearly on an audience that cannot be used and on one that never becomes ready", async () => {
    const ads = fakeAds();
    const c = ads.call();
    await expect(waitForAudienceReady(c, "caud_missing", { wait: ads.wait })).rejects.toBeInstanceOf(OpenAiApiError);
    const created = await createAudience(c, { name: "x y z", description: "d" });
    await expect(waitForAudienceReady(c, created.id, { wait: ads.wait, timeoutMs: 3000 })).rejects.toBeInstanceOf(
      OpenAiWaitTimeout
    );
    const real = ads.fetch;
    const archived: OpenAiAdsCall = {
      ...c,
      fetch: async (url, init) =>
        url.endsWith(created.id) ? json({ id: created.id, status: "archived" }) : real(url, init),
    };
    await expect(waitForAudienceReady(archived, created.id, { wait: ads.wait })).rejects.toBeInstanceOf(
      OpenAiAudienceUnusable
    );
  });
  it("retries an Add that arrives before the audience is ready with the SAME key, and applies it once", async () => {
    const ads = fakeAds();
    const c = ads.call();
    const { id } = await createAudience(c, { name: "jitsu test", description: "marker" });
    const op = await submitMembership(c, id, "add", ids(1), "key-1", { wait: ads.wait });
    expect(op.status).toBe("processing");
    expect(ads.log.filter(l => l.endsWith("/add")).length).toBeGreaterThan(1);
    expect(ads.operations.size).toBe(1);
    const done = await waitForOperation(c, id, op.operation_id, { wait: ads.wait });
    expect(done.status).toBe("succeeded");
  });
  it("returns the same operation for the same key, even while it is processing and after it finished", async () => {
    const ads = fakeAds();
    const c = ads.call();
    const { id } = await createAudience(c, { name: "jitsu test", description: "marker" });
    await waitForAudienceReady(c, id, { wait: ads.wait });
    const first = await submitMembership(c, id, "add", ids(1), "key-1", { wait: ads.wait });
    const replayWhileProcessing = await submitMembership(c, id, "add", ids(1), "key-1", { wait: ads.wait });
    expect(replayWhileProcessing.operation_id).toBe(first.operation_id);
    await waitForOperation(c, id, first.operation_id, { wait: ads.wait });
    const replayAfter = await submitMembership(c, id, "add", ids(1), "key-1", { wait: ads.wait });
    expect(replayAfter).toMatchObject({ operation_id: first.operation_id, status: "succeeded" });
    expect(ads.operations.size).toBe(1);
  });
  it("queues a second operation behind the first instead of conflicting", async () => {
    const ads = fakeAds();
    const c = ads.call();
    const { id } = await createAudience(c, { name: "jitsu test", description: "marker" });
    await waitForAudienceReady(c, id, { wait: ads.wait });
    const a = await submitMembership(c, id, "add", ids(1), "key-a", { wait: ads.wait });
    const b = await submitMembership(c, id, "remove", ids(2), "key-b", { wait: ads.wait });
    const start = ads.time();
    expect((await waitForOperation(c, id, a.operation_id, { wait: ads.wait })).status).toBe("succeeded");
    expect((await waitForOperation(c, id, b.operation_id, { wait: ads.wait })).status).toBe("succeeded");
    expect(ads.time() - start).toBeGreaterThanOrEqual(20_000);
  });
  it("refuses a malformed identifier at submit as a definite rejection that names the code", async () => {
    const ads = fakeAds();
    const c = ads.call();
    const { id } = await createAudience(c, { name: "jitsu test", description: "marker" });
    await waitForAudienceReady(c, id, { wait: ads.wait });
    const error: any = await submitMembership(
      c,
      id,
      "add",
      [{ identifier_type: "email_sha256", identifier: "zz" }],
      "k",
      {
        wait: ads.wait,
      }
    ).catch(e => e);
    expect(error).toBeInstanceOf(OpenAiApiError);
    expect([error.status, error.code, error.rejected]).toEqual([422, "custom_audience_operation_invalid", true]);
    expect(ads.operations.size).toBe(0);
    expect(String(error.message)).not.toContain("private detail");
  });
  it("does not read Cloudflare's plain-text 403 as an OpenAI refusal", async () => {
    const c: OpenAiAdsCall = {
      apiKey: "ads-key",
      signal: new AbortController().signal,
      fetch: async () => new Response("error code: 1010\n", { status: 403 }),
    };
    const error: any = await adAccountId(c).catch(e => e);
    expect(error).toBeInstanceOf(OpenAiApiError);
    expect([error.status, error.hasEnvelope, error.rejected]).toEqual([403, false, false]);
  });
  it("keeps polling through a 503 status call, an unknown status and a rate limit, then returns the final status", async () => {
    const ads = fakeAds();
    const c = ads.call();
    const { id } = await createAudience(c, { name: "jitsu test", description: "marker" });
    await waitForAudienceReady(c, id, { wait: ads.wait });
    const op = await submitMembership(c, id, "add", ids(1), "key-1", { wait: ads.wait });
    ads.hooks.operationStatus = n =>
      n === 1
        ? refusal(503, "custom_audience_operation_unavailable")
        : n === 2
        ? refusal(429, "rate_limit_exceeded")
        : n === 3
        ? "reindexing"
        : "";
    const done = await waitForOperation(c, id, op.operation_id, { wait: ads.wait });
    expect(done.status).toBe("succeeded");
    expect(ads.hooks.operationCalls).toBeGreaterThan(3);
  });
  it("resumes an interrupted operation by id and keeps polling it", async () => {
    const ads = fakeAds();
    const c = ads.call();
    const { id } = await createAudience(c, { name: "jitsu test", description: "marker" });
    await waitForAudienceReady(c, id, { wait: ads.wait });
    const op = await submitMembership(c, id, "add", ids(1), "key-1", { wait: ads.wait });
    ads.hooks.operationStatus = n => (n === 1 ? refusal(409, "custom_audience_operation_recovery_required") : "");
    expect((await waitForOperation(c, id, op.operation_id, { wait: ads.wait })).status).toBe("succeeded");
    expect(ads.log).toContain(`POST /custom_audiences/${id}/operations/${op.operation_id}/resume`);
  });
  it("throws a timeout, never a result, when an operation does not finish", async () => {
    const ads = fakeAds();
    const c = ads.call();
    const { id } = await createAudience(c, { name: "jitsu test", description: "marker" });
    await waitForAudienceReady(c, id, { wait: ads.wait });
    const op = await submitMembership(c, id, "add", ids(1), "key-1", { wait: ads.wait });
    ads.hooks.operationStatus = () => "processing";
    await expect(
      waitForOperation(c, id, op.operation_id, { wait: ads.wait, timeoutMs: 60_000 })
    ).rejects.toBeInstanceOf(OpenAiWaitTimeout);
  });
  it("honors Retry-After and keeps the same key when rate limited on submit", async () => {
    const ads = fakeAds();
    const c = ads.call();
    const { id } = await createAudience(c, { name: "jitsu test", description: "marker" });
    await waitForAudienceReady(c, id, { wait: ads.wait });
    const real = ads.fetch;
    const sent: (string | undefined)[] = [];
    let first = true;
    const limited: OpenAiAdsCall = {
      ...c,
      fetch: async (url, init) => {
        if (url.endsWith("/add")) {
          sent.push(init.headers["Idempotency-Key"]);
          if (first) {
            first = false;
            return refusal(429, "rate_limit_exceeded", { "retry-after": "7" });
          }
        }
        return real(url, init);
      },
    };
    const before = ads.time();
    await submitMembership(limited, id, "add", ids(1), "key-1", { wait: ads.wait });
    expect(sent).toEqual(["key-1", "key-1"]);
    expect(ads.time() - before).toBe(7000);
  });
  it("reads a missing Retry-After header as no hint, and never spins on a hint of 0", async () => {
    const respond = (headers: Record<string, string>): OpenAiAdsCall => ({
      apiKey: "ads-key",
      signal: new AbortController().signal,
      fetch: async () => refusal(429, "rate_limit_exceeded", headers),
    });
    const none: any = await adAccountId(respond({})).catch(e => e);
    expect(none.retryAfter).toBeUndefined();
    const zero: any = await adAccountId(respond({ "retry-after": "0" })).catch(e => e);
    expect(zero.retryAfter).toBe(0);
    // A 429 that keeps coming, with a hint of 0: every retry still sleeps, so the budget runs out instead of looping.
    const ads = fakeAds();
    const sleeps: number[] = [];
    const wait: OpenAiWait = {
      now: ads.wait.now,
      sleep: async (ms, signal) => {
        sleeps.push(ms);
        await ads.wait.sleep(ms, signal);
      },
    };
    const limited: OpenAiAdsCall = {
      ...ads.call(),
      fetch: async () => refusal(429, "rate_limit_exceeded", { "retry-after": "0" }),
    };
    await expect(
      submitMembership(limited, "caud_1", "add", ids(1), "k", { wait, retryBudgetMs: 10_000 })
    ).rejects.toBeInstanceOf(OpenAiApiError);
    expect(sleeps.length).toBeGreaterThan(0);
    expect(Math.min(...sleeps)).toBeGreaterThanOrEqual(500);
  });
  it("never retries a lost connection on submit: the caller must reconcile", async () => {
    const c: OpenAiAdsCall = {
      apiKey: "ads-key",
      signal: new AbortController().signal,
      fetch: async () => {
        throw new Error("socket hang up");
      },
    };
    let calls = 0;
    const counted: OpenAiAdsCall = { ...c, fetch: async (...a) => (calls++, c.fetch(...a)) };
    await expect(submitMembership(counted, "caud_1", "add", ids(1), "key-1")).rejects.toBeInstanceOf(
      OpenAiTransportError
    );
    expect(calls).toBe(1);
  });
  it("finds the audience carrying a marker by scanning newest-first pages", async () => {
    const ads = fakeAds();
    const c = ads.call();
    for (let i = 0; i < 230; i++)
      await createAudience(c, { name: `audience ${i}`, description: i === 40 ? "xx jitsu-retl-abc xx" : "other" });
    expect(await findAudiencesByMarker(c, "jitsu-retl-abc")).toEqual([audienceId(41)]);
    expect(await findAudiencesByMarker(c, "jitsu-retl-nope")).toEqual([]);
    expect(ads.log.filter(l => l === "GET /custom_audiences").length).toBeGreaterThanOrEqual(3);
  });
  it("stops waiting when the run is aborted", async () => {
    const ads = fakeAds();
    const controller = new AbortController();
    const c = ads.call(controller.signal);
    const { id } = await createAudience(c, { name: "jitsu test", description: "marker" });
    controller.abort(new Error("run cancelled"));
    await expect(waitForAudienceReady(c, id, { wait: ads.wait })).rejects.toThrow("run cancelled");
  });
  it("getAudience parses the open status string", async () => {
    const ads = fakeAds();
    const { id } = await createAudience(ads.call(), { name: "jitsu test", description: "marker" });
    expect((await getAudience(ads.call(), id)).status).toBe("rockset_ingest_pending");
  });
});
