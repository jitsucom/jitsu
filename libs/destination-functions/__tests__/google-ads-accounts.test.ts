import { expect, it, vi } from "vitest";
import { listGoogleAccounts } from "../src/functions/google-ads/accounts";

const root = "1111111111";
const child = "2222222222";
const json = (body: unknown) => Response.json(body);
const account = (id: string, name = "Account") => ({ customerClient: { id, descriptiveName: name, manager: false } });
const metadata = (id: string, manager: boolean, name = "Account", status = "ENABLED") =>
  json({ results: [{ customer: { id, manager, descriptiveName: name, status } }] });
it("lists direct and manager-accessible accounts with distinct access routes and fixed read-only requests", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ resourceNames: [`customers/${root}`, `customers/${child}`] }))
    .mockResolvedValueOnce(metadata(root, true))
    .mockResolvedValueOnce(json({ results: [account(child, "Managed account")], nextPageToken: "next" }))
    .mockResolvedValueOnce(json({ results: [account("3333333333")] }))
    .mockResolvedValueOnce(metadata(child, false, "Direct account"));
  const result = await listGoogleAccounts("oauth-token", "dev-token", request);
  expect(result).toMatchObject({ truncated: false, partial: false });
  expect(result.options).toEqual([
    {
      value: `${child}:${root}`,
      customerId: child,
      loginCustomerId: root,
      label: `Managed account (${child}) · manager ${root}`,
    },
    {
      value: `3333333333:${root}`,
      customerId: "3333333333",
      loginCustomerId: root,
      label: `Account (3333333333) · manager ${root}`,
    },
    { value: `${child}:`, customerId: child, loginCustomerId: "", label: `Direct account (${child})` },
  ]);
  expect(request.mock.calls[0][0]).toBe("https://googleads.googleapis.com/v22/customers:listAccessibleCustomers");
  expect(request.mock.calls[0][1]?.headers).not.toHaveProperty("login-customer-id");
  expect(request.mock.calls[1][1]?.headers).toMatchObject({
    "login-customer-id": root,
    "developer-token": "dev-token",
  });
  expect(JSON.parse(request.mock.calls[3][1]?.body as string)).toMatchObject({ pageToken: "next" });
  expect(JSON.parse(request.mock.calls[4][1]?.body as string).query).toContain("FROM customer");
  expect(request).toHaveBeenCalledTimes(5);
  for (const [, options] of request.mock.calls) expect(options?.redirect).toBe("error");
});
it("retains successful accounts and marks failed roots as partial", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ resourceNames: [`customers/${root}`, `customers/${child}`] }))
    .mockResolvedValueOnce(new Response("sensitive diagnostic", { status: 403 }))
    .mockResolvedValueOnce(metadata(child, false));
  expect(await listGoogleAccounts("token", "dev", request)).toMatchObject({
    partial: true,
    options: [{ customerId: child }],
  });
});
it("does not claim an empty successful list when every root fails", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ resourceNames: [`customers/${root}`] }))
    .mockResolvedValue(new Response("secret", { status: 403 }));
  await expect(listGoogleAccounts("token", "dev", request)).rejects.toThrow("Check OAuth");
});
it("needs a developer token only for discovery, and makes no request when it is missing", async () => {
  const request = vi.fn<typeof fetch>();
  await expect(listGoogleAccounts("token", undefined, request)).rejects.toThrow(
    "enter Customer ID and Manager ID manually"
  );
  expect(request).not.toHaveBeenCalled();
});
it("bounds pagination even when the provider repeats its continuation", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ resourceNames: [`customers/${root}`] }))
    .mockResolvedValueOnce(metadata(root, true))
    .mockImplementation(async () => json({ results: [account(child)], nextPageToken: "again" }));
  const result = await listGoogleAccounts("token", "dev", request);
  expect(result.truncated).toBe(true);
  expect(result.options).toHaveLength(1);
  expect(request).toHaveBeenCalledTimes(41);
});
it("bounds account count and root traversal", async () => {
  const roots = Array.from({ length: 21 }, (_, i) => `customers/${1000000000 + i}`);
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ resourceNames: roots }))
    .mockImplementation(async url => metadata(String(url).split("/customers/")[1].split("/")[0], false));
  expect((await listGoogleAccounts("token", "dev", request)).truncated).toBe(true);
  expect(request).toHaveBeenCalledTimes(21);
  request
    .mockReset()
    .mockResolvedValueOnce(json({ resourceNames: [`customers/${root}`] }))
    .mockResolvedValueOnce(metadata(root, true))
    .mockResolvedValueOnce(json({ results: Array.from({ length: 1001 }, (_, i) => account(String(2000000000 + i))) }));
  const result = await listGoogleAccounts("token", "dev", request);
  expect(result.truncated).toBe(true);
  expect(result.options).toHaveLength(1000);
});
it("does not list disabled direct accounts and rejects mismatched root metadata", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ resourceNames: [`customers/${root}`] }))
    .mockResolvedValueOnce(metadata(root, false, "Cancelled", "CANCELED"));
  expect(await listGoogleAccounts("token", "dev", request)).toEqual({ options: [], partial: false, truncated: false });
  request
    .mockReset()
    .mockResolvedValueOnce(json({ resourceNames: [`customers/${root}`] }))
    .mockResolvedValueOnce(metadata(child, false));
  await expect(listGoogleAccounts("token", "dev", request)).rejects.toThrow("Could not load");
});
it("rejects malformed root IDs without using them in requests", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ resourceNames: ["customers/../../evil"] }));
  await expect(listGoogleAccounts("token", "dev", request)).rejects.toThrow("Could not load");
  expect(request).toHaveBeenCalledTimes(1);
});
it("stops on cancellation and distinguishes genuinely empty accessible accounts", async () => {
  const controller = new AbortController();
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ resourceNames: [`customers/${root}`, `customers/${child}`] }))
    .mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });
  await expect(listGoogleAccounts("token", "dev", request, controller.signal)).rejects.toThrow("Could not load");
  expect(request).toHaveBeenCalledTimes(2);
  request.mockReset().mockResolvedValueOnce(json({ resourceNames: [] }));
  expect(await listGoogleAccounts("token", "dev", request)).toEqual({ options: [], truncated: false, partial: false });
});
