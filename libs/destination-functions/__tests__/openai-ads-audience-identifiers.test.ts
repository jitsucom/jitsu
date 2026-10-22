import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  openAiAudienceEmail,
  openAiAudienceGaid,
  openAiAudienceIdentifiers,
  openAiAudiencePhone,
} from "../src/functions/openai-ads/audience-identifiers";
import { digest, openAiNormalize } from "../src/functions/openai-ads/identifiers";
import { openAiAudienceValidationErrors } from "../src/functions/openai-ads/validation-errors";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const invalid = (row: Record<string, unknown>, reason: keyof typeof openAiAudienceValidationErrors = "identifier") =>
  expect(() => openAiAudienceIdentifiers(row)).toThrow(
    `Invalid OpenAI audience member: ${openAiAudienceValidationErrors[reason]}`
  );

describe("OpenAI audience identifiers (Custom Audiences API rules)", () => {
  it("matches the digests printed in OpenAI's own mixed-CSV example", () => {
    // From developers.openai.com/ads/custom-audiences, "Combine identifier types in one CSV".
    expect(digest(openAiAudienceEmail("  Jamie@Example.com "))).toBe(
      "057a0fff4c78ae3e14236c36b611061cbdd54ccd72a34b23f77d7a8c4bca4963"
    );
    expect(digest(openAiAudiencePhone("+1 (202) 555-0124"))).toBe(
      "1a2d415d4fef1dfafe57e0d98af15bbad8cc4bd8ca8ac66e89f2e0ef3941d500"
    );
  });
  it("hashes the phone WITH the plus, unlike the Conversions API", () => {
    expect(openAiAudiencePhone("12025550124")).toBe("+12025550124");
    expect(openAiAudiencePhone("0012025550124")).toBe("+12025550124");
    expect(openAiAudiencePhone("+44 20 7946 0958")).toBe("+442079460958");
    // The two APIs must never share a phone function: same number, different digest.
    expect(digest(openAiNormalize("phone", "+12025550124"))).not.toBe(digest(openAiAudiencePhone("+12025550124")));
    expect(openAiNormalize("phone", "+12025550124")).toBe("12025550124");
  });
  it("keeps email dots and plus tags", () => {
    expect(openAiAudienceEmail("First.Last+tag@Example.com")).toBe("first.last+tag@example.com");
  });
  it("accepts a raw, nonzero, hyphenated GAID in lower case and refuses anything else", () => {
    expect(openAiAudienceGaid(" 38400000-8CF0-11BD-B23E-10B96E40000D ")).toBe("38400000-8cf0-11bd-b23e-10b96e40000d");
    for (const bad of [
      "00000000-0000-0000-0000-000000000000",
      "384000008cf011bdb23e10b96e40000d",
      "not-a-gaid",
      sha("x"),
    ])
      expect(() => openAiAudienceGaid(bad)).toThrow("Invalid OpenAI audience member");
  });
  it("builds one identifier per type, in a fixed order, hashing raw values once", () => {
    const row = { gaid: "38400000-8cf0-11bd-b23e-10b96e40000d", phone: "+12025550124", email: "Jamie@example.com" };
    const ids = openAiAudienceIdentifiers(row);
    expect(ids.map(i => i.identifier_type)).toEqual(["email_sha256", "phone_number_sha256", "gaid"]);
    expect(ids[0].identifier).toBe(sha("jamie@example.com"));
    expect(ids[1].identifier).toBe(sha("+12025550124"));
    expect(ids[2].identifier).toBe("38400000-8cf0-11bd-b23e-10b96e40000d");
    // Same bytes for the same row however the keys were ordered: the idempotency key depends on it.
    expect(
      JSON.stringify(openAiAudienceIdentifiers({ email: "Jamie@example.com", phone: "+12025550124", gaid: row.gaid }))
    ).toBe(JSON.stringify(ids));
  });
  it("accepts pre-hashed email and phone as 64 hex, lowercased, and never hashes them again", () => {
    const hashed = sha("jamie@example.com").toUpperCase();
    expect(openAiAudienceIdentifiers({ hashedEmail: ` ${hashed} ` })).toEqual([
      { identifier_type: "email_sha256", identifier: sha("jamie@example.com") },
    ]);
    expect(openAiAudienceIdentifiers({ hashedPhone: sha("+12025550124") })[0].identifier_type).toBe(
      "phone_number_sha256"
    );
  });
  it("refuses a raw and a pre-hashed column for the same identifier, and malformed values, instead of dropping them", () => {
    invalid({ email: "a@example.com", hashedEmail: sha("a@example.com") });
    invalid({ phone: "+12025550124", hashedPhone: sha("x") });
    invalid({ hashedEmail: "not-a-hash" });
    invalid({ hashedPhone: sha("x").slice(0, 63) });
    invalid({ email: "no-at-sign" });
    invalid({ phone: "12345" });
    invalid({ phone: "+0123456789" });
    invalid({ email: 5 });
    invalid({ gaid: 7 });
  });
  it("needs at least one identifier and treats null and empty cells as absent", () => {
    invalid({}, "noIdentifier");
    invalid({ email: null, phone: "", gaid: undefined }, "noIdentifier");
    expect(openAiAudienceIdentifiers({ email: null, phone: "+12025550124" })).toHaveLength(1);
  });
});
