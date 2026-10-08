import { describe, it, expect, vi } from "vitest";
import { readMetaResults, type MetaResultTarget } from "../src/functions/facebook/results";
import { MetaDestinationResults } from "../src/functions/facebook/results-meta";
import type { MetaFetch } from "../src/functions/facebook/client";
const credentials = { accessToken: "private-token" };
const snapshot = { sourceRows: 5000, uniqueMembers: 5000, observedAt: "2026-10-08T00:00:00Z" };
const target: MetaResultTarget = {
  stream: "audience",
  audienceId: "456",
  accountId: "123",
  valueBased: false,
  managed: true,
  snapshot,
};
const data = {
  id: "456",
  account_id: "123",
  subtype: "CUSTOM",
  is_value_based: false,
  approximate_count_lower_bound: 2900,
  approximate_count_upper_bound: 3100,
  operation_status: { code: 200, description: "never-return" },
  delivery_status: { code: 200 },
  private: "never-return",
};
const request = (data: unknown, status = 200) =>
  vi.fn<MetaFetch>().mockResolvedValue({ ok: status === 200, status, json: async () => data });
describe("current Meta destination metrics", () => {
  it("returns sanitized approximate size and an eligible managed match range using full-model counts", async () => {
    const fetch = request(data);
    const result = await readMetaResults(credentials, target, fetch);
    expect(result).toMatchObject({
      kind: "audience",
      size: { status: "available", lower: 2900, upper: 3100 },
      matchRate: { status: "available", lower: expect.closeTo(58), upper: expect.closeTo(62) },
      denominatorRows: 5000,
    });
    expect(JSON.stringify(result)).not.toContain("never-return");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Bearer private-token" },
    });
    expect(fetch.mock.calls[0][0]).not.toContain("private-token");
    expect(MetaDestinationResults.safeParse(result).success).toBe(true);
  });
  it.each([
    [{ managed: false, snapshot: undefined }, "not-eligible"],
    [{ snapshot: undefined }, "no-snapshot"],
    [{ snapshot: { ...snapshot, sourceRows: 0, uniqueMembers: 0 } }, "empty-snapshot"],
    [{ snapshot: { ...snapshot, uniqueMembers: 4900 } }, "not-eligible"],
  ])("does not invent a match rate without an eligible snapshot: %j", async (patch, reason) => {
    expect(
      await readMetaResults(credentials, { ...target, ...patch } as MetaResultTarget, request(data))
    ).toMatchObject({ kind: "audience", matchRate: { status: "unavailable", reason } });
  });
  it.each([
    [{ approximate_count_lower_bound: null, approximate_count_upper_bound: null }, "not-reported"],
    [{ approximate_count_lower_bound: -1 }, "privacy-limited"],
    [{ approximate_count_lower_bound: 4000, approximate_count_upper_bound: 3000 }, "invalid-response"],
    [{ approximate_count_lower_bound: "2900" }, "invalid-response"],
  ])("keeps absent or invalid size distinct from zero: %j", async (patch, reason) => {
    expect(await readMetaResults(credentials, target, request({ ...data, ...patch }))).toMatchObject({
      size: { status: "unavailable", reason },
    });
  });
  it.each([
    [{ operation_status: { code: 441 } }, "processing"],
    [{ approximate_count_lower_bound: 0, approximate_count_upper_bound: 1000 }, "privacy-limited"],
    [{ approximate_count_lower_bound: 4900, approximate_count_upper_bound: 5100 }, "processing"],
  ])("does not produce a rate from pending or privacy-limited estimates: %j", async (patch, reason) => {
    expect(await readMetaResults(credentials, target, request({ ...data, ...patch }))).toMatchObject({
      matchRate: { status: "unavailable", reason },
    });
  });
  it("verifies account, subtype, value-based type and managed ownership marker", async () => {
    for (const patch of [{ id: "457" }, { account_id: "124" }, { subtype: "LOOKALIKE" }, { is_value_based: true }])
      expect(await readMetaResults(credentials, target, request({ ...data, ...patch }))).toMatchObject({
        kind: "unavailable",
        reason: "target-access",
      });
    expect(
      await readMetaResults(credentials, { ...target, ownershipMarker: "jitsu-marker" }, request(data))
    ).toMatchObject({ kind: "unavailable" });
  });
  it("reads actual EMQ and ACR without estimating either from accepted events or requesting payloads", async () => {
    const fetch = request({
      web: [
        {
          event_name: "Purchase",
          event_match_quality: { composite_score: 8.6, private: "never-return" },
          acr: { percentage: 37.9, description: "never-return" },
        },
        { event_name: "Lead", event_match_quality: { composite_score: 0 }, acr: { percentage: 0 } },
        { event_name: "ViewContent", event_match_quality: null },
        { event_name: "Other", event_match_quality: { composite_score: 11 }, acr: { percentage: 150 } },
      ],
    });
    const result = await readMetaResults(credentials, { stream: "conversions", pixelId: "789" }, fetch);
    expect(result).toMatchObject({
      kind: "conversions",
      events: [
        { eventName: "Purchase", emq: { status: "available", value: 8.6 }, acr: { status: "available", value: 37.9 } },
        { eventName: "Lead", emq: { status: "available", value: 0 }, acr: { status: "available", value: 0 } },
        {
          eventName: "ViewContent",
          emq: { status: "unavailable", reason: "not-reported" },
          acr: { status: "unavailable" },
        },
        {
          eventName: "Other",
          emq: { status: "unavailable", reason: "invalid-response" },
          acr: { status: "available", value: 150 },
        },
      ],
    });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe("/v26.0/dataset_quality");
    expect(url.searchParams.get("dataset_id")).toBe("789");
    expect(url.searchParams.get("fields")).toBe("web{event_name,event_match_quality{composite_score},acr{percentage}}");
    expect(url.searchParams.has("agent_name")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("never-return");
  });
  it("returns empty quality data separately from an invalid response", async () => {
    expect(
      await readMetaResults(credentials, { stream: "conversions", pixelId: "789" }, request({ web: [] }))
    ).toMatchObject({ kind: "conversions", events: [] });
    expect(await readMetaResults(credentials, { stream: "conversions", pixelId: "789" }, request({}))).toMatchObject({
      kind: "unavailable",
      reason: "invalid-response",
    });
  });
  it.each([
    [190, "credentials"],
    [200, "permissions"],
    [4, "temporarily-unavailable"],
    [100, "target-access"],
  ])("sanitizes Graph code %s", async (code, reason) => {
    const result = await readMetaResults(
      credentials,
      { stream: "conversions", pixelId: "789" },
      request({ error: { code, message: "private-token never-return" } }, 400)
    );
    expect(result).toMatchObject({ kind: "unavailable", reason });
    expect(JSON.stringify(result)).not.toMatch(/private-token|never-return/);
  });
  it("rejects ID path injection before sending any request", async () => {
    const fetch = request(data);
    expect(await readMetaResults(credentials, { ...target, audienceId: "456/../me" }, fetch)).toMatchObject({
      kind: "unavailable",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
