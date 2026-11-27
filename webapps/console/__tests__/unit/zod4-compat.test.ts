import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BillingSettings } from "../../lib/schema";
import { DataRetentionSettings } from "../../lib/shared/data-retention";
import { getZodDescription } from "../../lib/zod";
import { zodToJsonSchema } from "../../lib/schema/zod-json-schema";

// Behaviour zod 4 changes without a type error. Each case here broke (or would have) silently in the zod 3 -> 4 move.
describe("zod 4 compatibility", () => {
  it("leaves absent plan flags and limits absent (zod 4 fills .default().optional())", () => {
    const parsed = BillingSettings.parse({ planId: "free" });
    for (const key of [
      "customBilling",
      "pastDue",
      "planKind",
      "custom",
      "dailyActiveSyncs",
      "dailyActiveSyncsOverage",
      "dataRetentionEditorEnabled",
      "renewAfterExpiration",
      "profileBuilderEnabled",
      "observabilityExportsEnabled",
      "isLegacyPlan",
    ]) {
      expect(parsed, key).not.toHaveProperty(key);
    }
  });

  it("leaves absent retention flags absent", () => {
    const parsed = DataRetentionSettings.parse({
      kafkaRetentionHours: 1,
      identityStitchingRetentionDays: 2,
      logsRetentionDays: { maxRecords: 3, maxHours: 4 },
    });
    expect(parsed).not.toHaveProperty("disableS3Archive");
    expect(parsed).not.toHaveProperty("pendingUpdate");
  });

  it("finds a description through optional / default / nullable wrappers", () => {
    const described = z.string().describe("Label::Hint");
    expect(getZodDescription(described)).toBe("Label::Hint");
    expect(getZodDescription(described.optional())).toBe("Label::Hint");
    expect(getZodDescription(described.default("x"))).toBe("Label::Hint");
    expect(getZodDescription(described.nullable().optional())).toBe("Label::Hint");
    expect(getZodDescription(z.object({ a: described }).partial().shape.a)).toBe("Label::Hint");
    expect(getZodDescription(z.string())).toBeUndefined();
  });

  it("accepts an object key declared z.any() / z.unknown() when it is absent", () => {
    // bare z.any() is rejected when absent in zod 4; the schemas use .optional() to keep accepting it
    expect(z.object({ a: z.any().optional(), b: z.unknown().optional() }).safeParse({}).success).toBe(true);
  });
});

describe("JSON schema helper keeps the zod 3 output the config editor relies on", () => {
  const schema = z.object({
    name: z.string(),
    createdAt: z.coerce.date().nullish(),
    data: z.any().optional(),
    mode: z.enum(["a", "b"]).default("a"),
  });
  const json = zodToJsonSchema(schema);

  it("describes dates as date-time strings", () => {
    expect(json.properties.createdAt.anyOf[0]).toEqual({ type: "string", format: "date-time" });
  });

  it("closes objects that strip unknown keys, and leaves loose ones open", () => {
    expect(json.additionalProperties).toBe(false);
    expect(zodToJsonSchema(z.looseObject({ a: z.string() })).additionalProperties).not.toBe(false);
  });

  it("requires only what a caller must send", () => {
    expect(json.required).toEqual(["name"]);
  });
});
