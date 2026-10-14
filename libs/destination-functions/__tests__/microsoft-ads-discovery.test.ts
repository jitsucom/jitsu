import { expect, it, vi } from "vitest";
import { listMicrosoftTargets, microsoftReadClient } from "../src/functions/microsoft-ads/discovery";

const auth = { accessToken: "oauth-secret", developerToken: "dev-secret", customerId: "123", accountId: "456" };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
it("discovers accessible accounts without requiring saved account/customer IDs", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ User: { Id: "9223372036854775807" } }))
    .mockResolvedValueOnce(
      response({ Accounts: [{ Id: "9007199254740993", ParentCustomerId: "123", Name: "Example" }] })
    );
  const result = await listMicrosoftTargets(
    microsoftReadClient({ accessToken: auth.accessToken, developerToken: auth.developerToken }, request),
    "microsoft-account"
  );
  expect(result.options[0]).toMatchObject({ value: "9007199254740993", customerId: "123" });
  expect(request.mock.calls[0][1]?.headers).not.toHaveProperty("CustomerId");
  expect(JSON.parse(String(request.mock.calls[1][1]?.body)).Predicates[0].Value).toBe("9223372036854775807");
});
it("bounds account pagination and marks a truncated list", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ User: { Id: 1 } }))
    .mockImplementation(async () =>
      response({
        Accounts: Array.from({ length: 100 }, (_, i) => ({ Id: i + 1, ParentCustomerId: 123, Name: "Account" })),
      })
    );
  const result = await listMicrosoftTargets(microsoftReadClient(auth, request), "microsoft-account");
  expect(result.truncated).toBe(true);
  expect(request).toHaveBeenCalledTimes(11);
});
it("uses exact goal names as values and filters the API to offline goals", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    response({
      ConversionGoals: [null, { Id: 7, Name: "Purchase, offline", Type: "OfflineConversion", Status: "Active" }],
    })
  );
  const result = await listMicrosoftTargets(microsoftReadClient(auth, request), "microsoft-goal");
  expect(result.options[0].value).toBe("Purchase, offline");
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ ConversionGoalTypes: "OfflineConversion" });
  expect(request.mock.calls[0][1]?.headers).toMatchObject({ CustomerId: "123", CustomerAccountId: "456" });
});
it("lists Customer Match audiences including shared lists without imposing parent ownership", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response({ Audiences: [{ Id: 7, Name: "Shared", Type: "CustomerList", ParentId: 999 }] }));
  expect((await listMicrosoftTargets(microsoftReadClient(auth, request), "microsoft-audience")).options[0].value).toBe(
    "7"
  );
});
it("rejects unsafe numeric IDs rather than silently rounding them", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response({ Audiences: [{ Id: 9007199254740992, Name: "Bad", Type: "CustomerList" }] }));
  await expect(listMicrosoftTargets(microsoftReadClient(auth, request), "microsoft-audience")).rejects.toThrow();
});
it.each([
  response({ Message: "private data" }, 403),
  response({ PartialErrors: [{ Message: "private data" }] }),
  new Response("private data"),
])("does not expose provider error bodies", async reply => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(reply);
  const error = await listMicrosoftTargets(microsoftReadClient(auth, request), "microsoft-audience").catch(e => e);
  expect(error.message).not.toContain("private data");
  expect(error.message).not.toContain("oauth-secret");
});
