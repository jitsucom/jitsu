import { describe, expect, it, vi } from "vitest";
import { checkMetaTarget, listMetaTargets } from "../src/functions/facebook/targets";
import type { MetaFetch } from "../src/functions/facebook/client";
const credentials = { accessToken: "private-token" };
const account = { id: "act_123", account_id: "123", name: "Test account", user_tasks: ["ADVERTISE"] };
const audience = {
  id: "456",
  name: "Customers",
  account_id: "123",
  subtype: "CUSTOM",
  is_value_based: false,
  permission_for_actions: { can_edit: true },
};
const settings = { accountId: "act_123", audience: { kind: "existing", audienceId: "456" } };
const response = (data: unknown, status = 200) => ({ ok: status === 200, status, json: async () => data });
const request = (...data: unknown[]) => {
  const fetch = vi.fn<MetaFetch>();
  for (const item of data) fetch.mockResolvedValueOnce(response(item));
  return fetch;
};
describe("Meta read-only target setup", () => {
  it("lists account names and numeric IDs with only GET and authorization headers", async () => {
    const fetch = request({ data: [account], secret: "private-token" });
    expect(await listMetaTargets(credentials, "meta-account", {}, fetch)).toEqual({
      options: [{ value: "123", label: "Test account (123)" }],
      truncated: false,
    });
    expect(fetch.mock.calls[0][0]).toContain("/me/adaccounts?");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { Authorization: "Bearer private-token" },
    });
    expect(fetch.mock.calls[0][0]).not.toContain("private-token");
  });
  it("filters audiences by account, subtype, value-based setting and explicit edit denial", async () => {
    const fetch = request({
      data: [
        audience,
        { ...audience, id: "457", subtype: "WEBSITE" },
        { ...audience, id: "458", account_id: "999" },
        { ...audience, id: "459", is_value_based: true },
        { ...audience, id: "460", permission_for_actions: { can_edit: false } },
      ],
    });
    expect(
      (await listMetaTargets(credentials, "meta-audience", { accountId: "act_123" }, fetch)).options.map(o => o.value)
    ).toEqual(["456"]);
    expect(fetch.mock.calls[0][0]).toContain("/act_123/customaudiences?");
    expect(
      (
        await listMetaTargets(
          credentials,
          "meta-audience",
          { accountId: "123", valueBased: true },
          request({ data: [{ ...audience, is_value_based: true }] })
        )
      ).options
    ).toHaveLength(1);
  });
  it("constructs bounded pagination from cursors and never follows provider URLs", async () => {
    const fetch = request(
      {
        data: [account],
        paging: { next: "https://evil.test/?access_token=private-token", cursors: { after: "cursor&fields=secret" } },
      },
      { data: [account, { ...account, id: "act_124", account_id: "124" }] }
    );
    const result = await listMetaTargets(credentials, "meta-account", {}, fetch);
    expect(result.options.map(o => o.value)).toEqual(["123", "124"]);
    const url = new URL(fetch.mock.calls[1][0]);
    expect(url.host).toBe("graph.facebook.com");
    expect(url.searchParams.get("after")).toBe("cursor&fields=secret");
    expect(url.searchParams.get("fields")).not.toBe("secret");
  });
  it("reports truncation and rejects missing/repeated cursors", async () => {
    const fetch = vi
      .fn<MetaFetch>()
      .mockImplementation(async () =>
        response({ data: [account], paging: { next: "ignored", cursors: { after: String(fetch.mock.calls.length) } } })
      );
    expect((await listMetaTargets(credentials, "meta-account", {}, fetch)).truncated).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(20);
    await expect(
      listMetaTargets(credentials, "meta-account", {}, request({ data: [], paging: { next: "ignored" } }))
    ).rejects.toThrow("pagination");
  });
  it("rejects path injection without issuing a request", async () => {
    const fetch = request();
    await expect(listMetaTargets(credentials, "meta-audience", { accountId: "123/../me" }, fetch)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("checks an existing audience and a managed account without writes", async () => {
    const fetch = request(account, audience, account);
    expect(await checkMetaTarget(credentials, "audience", settings, fetch)).toMatchObject({ name: "Customers" });
    expect(
      await checkMetaTarget(
        credentials,
        "audience",
        { accountId: "123", audience: { kind: "managed", name: "New" } },
        fetch
      )
    ).toMatchObject({ name: "Test account" });
    expect(fetch.mock.calls.every(([, r]) => r.method === "GET" && r.body === undefined)).toBe(true);
  });
  it.each([
    [{ subtype: "LOOKALIKE" }, "customer-list"],
    [{ account_id: "999" }, "different ad account"],
    [{ is_value_based: true }, "Value-based"],
    [{ permission_for_actions: { can_edit: false } }, "cannot edit"],
    [{ id: "999" }, "customer-list"],
  ])("rejects incompatible existing audiences: %j", async (patch, message) => {
    await expect(
      checkMetaTarget(credentials, "audience", settings, request(account, { ...audience, ...patch }))
    ).rejects.toThrow(String(message));
  });
  it("rejects reported read-only ad-account tasks", async () => {
    await expect(
      checkMetaTarget(credentials, "audience", settings, request({ ...account, user_tasks: ["ANALYZE"] }))
    ).rejects.toThrow("read-only");
  });
  it("verifies pixel-specific fields and explains the limits of read-only validation", async () => {
    const fetch = request({ id: "789", name: "Test dataset", is_unavailable: false });
    expect(await checkMetaTarget(credentials, "conversions", { pixelId: "789" }, fetch)).toMatchObject({
      name: "Test dataset",
      message: expect.stringContaining("does not prove conversion upload permission"),
    });
    expect(fetch.mock.calls[0][0]).toContain("789?fields=id,name,is_unavailable");
    await expect(
      checkMetaTarget(credentials, "conversions", { pixelId: "789" }, request({ id: "789", name: "App" }))
    ).rejects.toThrow("Could not verify");
    await expect(
      checkMetaTarget(
        credentials,
        "conversions",
        { pixelId: "789" },
        request({ id: "789", name: "Unavailable", is_unavailable: true })
      )
    ).rejects.toThrow("unavailable");
  });
  it("identifies a readable App ID with an application-specific field", async () => {
    const fetch = request();
    fetch
      .mockResolvedValueOnce(response({ error: { code: 100, message: "private-token bad field" } }, 400))
      .mockResolvedValueOnce(response({ id: "789", app_events_feature_bitmask: 0 }));
    await expect(checkMetaTarget(credentials, "conversions", { pixelId: "789" }, fetch)).rejects.toThrow(
      "Meta App ID, not a Pixel / Dataset ID"
    );
    expect(fetch.mock.calls.every(([, r]) => r.method === "GET")).toBe(true);
  });
  it.each([
    [190, "invalid or expired"],
    [200, "denied access"],
    [100, "Pixel / Dataset ID"],
    [4, "rate limited"],
  ])("gives sanitized diagnostics for Graph code %s", async (code, message) => {
    const fetch = request();
    fetch.mockResolvedValue(response({ error: { code, message: "private-token private provider payload" } }, 400));
    await expect(checkMetaTarget(credentials, "conversions", { pixelId: "789" }, fetch)).rejects.toThrow(
      String(message)
    );
    const error = await checkMetaTarget(credentials, "conversions", { pixelId: "789" }, fetch).catch(e => e);
    expect(String(error)).not.toMatch(/private-token|private provider/);
  });
});
