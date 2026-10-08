import { describe, expect, it, vi } from "vitest";
import { createGoogleAudienceManagement } from "../src/functions/google-ads/audience/management";

const credentials = {
  authorized: true,
  oauthConnectionId: "destination.dst",
  customerId: "1234567890",
  loginCustomerId: "9876543210",
};
const intent = { displayName: "Audience [Jitsu abc]", integrationCode: `jitsu-retl-${"a".repeat(64)}` };
const parent = "accountTypes/GOOGLE_ADS/accounts/1234567890";
const list = {
  ...intent,
  id: "1234",
  name: `${parent}/userLists/1234`,
  membershipDuration: "46656000s",
  membershipStatus: "OPEN",
  accessReason: "OWNED",
  ingestedUserListInfo: {
    uploadKeyTypes: ["CONTACT_ID"],
    contactIdInfo: { dataSourceType: "DATA_SOURCE_TYPE_FIRST_PARTY" },
  },
};
const proof = {
  ...intent,
  id: `retl-google-${"a".repeat(64)}`,
  syncId: "sync",
  customerId: credentials.customerId,
  audienceId: "1234",
  membershipDays: 540 as const,
};
const signal = () => new AbortController().signal;
function fixture(value: unknown = list) {
  const request = vi.fn<typeof fetch>(async () => Response.json(value));
  const token = vi.fn(async () => "private-token");
  return { api: createGoogleAudienceManagement(credentials, token, request), request, token };
}
describe("Google audience management", () => {
  it("creates a first-party 540-day contact list with only provider fields", async () => {
    const f = fixture();
    expect(await f.api.create({ ...intent, ...{ privateIntent: "not-sent" } }, signal())).toEqual({
      audienceId: "1234",
    });
    const [url, init] = f.request.mock.calls[0];
    expect(url).toBe(`https://datamanager.googleapis.com/v1/${parent}/userLists`);
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer private-token",
        "login-account": "accountTypes/GOOGLE_ADS/accounts/9876543210",
      },
    });
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      ...intent,
      membershipDuration: "46656000s",
      ingestedUserListInfo: list.ingestedUserListInfo,
    });
    expect(body).not.toHaveProperty("privateIntent");
  });
  it("reconciles by exact marker without another POST or treating absence as proof", async () => {
    const f = fixture({ userLists: [list] });
    expect(await f.api.reconcile(intent, signal())).toEqual({ audienceId: "1234" });
    expect(new URL(String(f.request.mock.calls[0][0])).searchParams.get("filter")).toBe(
      `integration_code = "${intent.integrationCode}"`
    );
    f.request.mockResolvedValueOnce(Response.json({}));
    expect(await f.api.reconcile(intent, signal())).toBeUndefined();
    expect(f.request.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it.each([
    { userLists: [list, list] },
    { userLists: [list], nextPageToken: "more" },
    { userLists: [{ ...list, integrationCode: "foreign" }] },
  ])("rejects ambiguous or mismatched discovery", async response => {
    await expect(fixture(response).api.reconcile(intent, signal())).rejects.toThrow("preserve creation evidence");
  });
  it.each([
    { name: `${parent}/userLists/999` },
    { id: "999" },
    { displayName: "renamed" },
    { readOnly: true },
    { accessReason: "SHARED" },
    { membershipStatus: "CLOSED" },
    { membershipDuration: "2592000s" },
    { ingestedUserListInfo: { uploadKeyTypes: ["MOBILE_ID"] } },
  ])("rejects changed remote managed binding", async change => {
    await expect(fixture({ ...list, ...change }).api.verifyManaged(proof, signal())).rejects.toThrow(
      "preserve creation evidence"
    );
  });
  it("verifies identity without assuming that estimated size is a baseline", async () => {
    const f = fixture({ ...list, sizeInfo: { displayNetworkMembersCount: "1000000" } });
    expect(await f.api.verifyManaged(proof, signal())).toEqual({ audienceId: "1234" });
    expect(f.request.mock.calls[0][0]).toBe(`https://datamanager.googleapis.com/v1/${parent}/userLists/1234`);
    await expect(f.api.verifyManaged({ ...proof, customerId: "9999999999" }, signal())).rejects.toThrow();
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("redacts provider/token failures and does not request after cancellation", async () => {
    const f = fixture();
    f.token.mockRejectedValueOnce(new Error("private-token"));
    await expect(f.api.create(intent, signal())).rejects.toThrow("preserve creation evidence");
    expect(f.request).not.toHaveBeenCalled();
    f.request.mockResolvedValueOnce(new Response("private-token", { status: 403 }));
    await expect(f.api.create(intent, signal())).rejects.not.toThrow("private-token");
    await expect(f.api.create(intent, AbortSignal.abort())).rejects.toThrow();
    expect(f.request).toHaveBeenCalledTimes(1);
  });
});
