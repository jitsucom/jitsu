import { describe, expect, it } from "vitest";
import { googleRequestError } from "../src/functions/google-ads/clients/errors";
import { rejectionDetailsMessage, safeRejectionDetails } from "../src/reverse-etl/rejection-details";

const response = (details: unknown, status = 400) =>
  new Response(
    JSON.stringify({
      error: {
        status: "INVALID_ARGUMENT",
        message: "private@example.com token=secret",
        details,
      },
    }),
    { status }
  );

describe("Google structured rejection details", () => {
  it("keeps field violations and reasons, never messages, metadata, or values", async () => {
    const error = await googleRequestError(
      response([
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "INVALID_ARGUMENT",
          metadata: { token: "private-token" },
        },
        {
          "@type": "type.googleapis.com/google.rpc.BadRequest",
          fieldViolations: [
            {
              field: "events.events[0].user_data.user_identifiers[1]",
              reason: "INVALID_HEX_ENCODING",
              description: "private@example.com",
              localizedMessage: { message: "private-secret" },
            },
            { field: "destinations[0].login_account.account_id", reason: "INVALID_NUMBER_FORMAT" },
          ],
        },
      ]),
      "conversion upload"
    );
    expect(error.definitiveRejection).toBe(true);
    expect(error.message).toContain("events.events[0].user_data.user_identifiers[1]: INVALID_HEX_ENCODING");
    expect(error.message).toContain("destinations[0].login_account.account_id: INVALID_NUMBER_FORMAT");
    expect(JSON.stringify(error)).not.toMatch(/private|token|secret/);
    expect(error.message).not.toMatch(/private|token|secret/);
  });

  it("keeps Google Ads field locations and error enums without triggers", async () => {
    const error = await googleRequestError(
      response([
        {
          "@type": "type.googleapis.com/google.ads.googleads.v22.errors.GoogleAdsFailure",
          errors: [
            {
              errorCode: { conversionUploadError: "INVALID_GCLID" },
              message: "private conversion",
              trigger: { stringValue: "private-click-id" },
              location: { fieldPathElements: [{ fieldName: "conversions", index: 0 }, { fieldName: "gclid" }] },
            },
          ],
        },
      ]),
      "conversion upload"
    );
    expect(error.details).toEqual([{ reason: "INVALID_GCLID", field: "conversions[0].gclid" }]);
    expect(error.message).not.toContain("private");
  });

  it("supports field-only violations and safely ignores malformed detail payloads", async () => {
    const error = await googleRequestError(
      response([
        null,
        { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: "private" },
        {
          "@type": "type.googleapis.com/google.rpc.BadRequest",
          fieldViolations: [null, { field: "events[0].event_timestamp" }],
        },
        { "@type": "unknown", reason: "SHOULD_NOT_APPEAR" },
      ]),
      "conversion upload"
    );
    expect(error.details).toEqual([{ reason: "INVALID_ARGUMENT", field: "events[0].event_timestamp" }]);
    expect(error.definitiveRejection).toBe(true);
    const proxy = await googleRequestError(new Response("private proxy body", { status: 502 }), "conversion upload");
    expect(proxy.definitiveRejection).toBe(false);
    expect(proxy.details).toEqual([]);
  });

  it("filters free text, map keys, URLs, control characters, oversized details, and duplicates", () => {
    const detail = { reason: "INVALID_CURRENCY_CODE", field: "events[0].currency" };
    expect(
      safeRejectionDetails([
        { reason: "Bearer private-token" },
        { reason: "INVALID_ARGUMENT", field: 'events["private@example.com"]' },
        { reason: "INVALID_ARGUMENT", field: "https://secret.example.com" },
        { reason: "INVALID_ARGUMENT", field: "events\nprivate" },
        { reason: "INVALID_ARGUMENT", field: "x".repeat(129) },
        { reason: "X".repeat(97) },
        { ...detail, description: "private" },
        detail,
        detail,
        { reason: "INVALID_NUMBER_FORMAT" },
        { reason: "INVALID_HEX_ENCODING" },
        { reason: "OMITTED" },
      ])
    ).toEqual([detail, { reason: "INVALID_NUMBER_FORMAT" }, { reason: "INVALID_HEX_ENCODING" }]);
    expect(rejectionDetailsMessage([{ reason: "bad message" }])).toBe("");
  });
});
