import { expect, it, vi } from "vitest";
import { listGoogleTargets } from "../src/functions/google-ads/targets";
import { GoogleConversionCredentials } from "../src/functions/google-ads/conversions/meta";
import { GoogleRequestError } from "../src/functions/google-ads/clients/errors";

const credentials = GoogleConversionCredentials.parse({
  authorized: true,
  customerId: "1234567890",
  loginCustomerId: "1111111111",
  oauthConnectionId: "destination.dst",
});

it("discovers conversion actions on v26 with pagination and manager authorization", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        results: [{ conversionAction: { id: "123", name: "Sale", type: "UPLOAD_CLICKS" } }],
        nextPageToken: "next",
      })
    )
    .mockResolvedValueOnce(
      Response.json({ results: [{ conversionAction: { id: "456", name: "Call", type: "UPLOAD_CALLS" } }] })
    );
  expect(await listGoogleTargets(credentials, "conversion-action", "private-token", "private-dev", request)).toEqual({
    options: [
      { value: "123", label: "Sale (123, UPLOAD_CLICKS)" },
      { value: "456", label: "Call (456, UPLOAD_CALLS)" },
    ],
  });
  for (const [url, init] of request.mock.calls) {
    expect(url).toBe("https://googleads.googleapis.com/v26/customers/1234567890/googleAds:search");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer private-token",
      "developer-token": "private-dev",
      "login-customer-id": "1111111111",
    });
    expect(init?.redirect).toBe("error");
  }
  expect(JSON.parse(request.mock.calls[1][1]!.body as string)).toMatchObject({ pageToken: "next" });
});

it.each(["audience", "conversion-action"] as const)("retains only safe %s rejection details", async kind => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json(
      {
        error: {
          status: "PERMISSION_DENIED",
          message: "private-token private-dev private@example.com",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
              metadata: { secret: "private" },
            },
          ],
        },
      },
      { status: 403 }
    )
  );
  const error = await listGoogleTargets(credentials, kind, "private-token", "private-dev", request).catch(
    error => error
  );
  expect(error).toBeInstanceOf(GoogleRequestError);
  expect(error.message).toContain("HTTP 403 (PERMISSION_DENIED)");
  expect(error.message).toContain("ACCESS_TOKEN_SCOPE_INSUFFICIENT");
  expect(error.message).not.toContain("private");
  if (kind === "audience") expect(String(request.mock.calls[0][0])).toContain("https://datamanager.googleapis.com/v1/");
});
