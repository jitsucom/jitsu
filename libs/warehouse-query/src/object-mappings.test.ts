import { expect, it } from "vitest";
import { ObjectMappings, ReverseSyncOptions } from "./schema";

it("keeps legacy options unchanged and retains composed mappings", () => {
  const options = { stream: "click-conversions", mode: "upsert", mapping: { conversionTimestamp: "ts" } };
  expect(ReverseSyncOptions.parse(options)).not.toHaveProperty("objectMappings");
  expect(
    ReverseSyncOptions.parse({ ...options, objectMappings: { customVariables: { tier: "level" } } }).objectMappings
  ).toEqual({ customVariables: { tier: "level" } });
});
it("rejects reserved names, whitespace normalization collisions, empty columns and oversized objects", () => {
  for (const value of [
    JSON.parse('{"customData":{"__proto__":"x"}}'),
    { customData: { " tier ": "x" } },
    { customData: { tier: "" } },
    { customData: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [String(i), "x"])) },
  ]) {
    expect(ObjectMappings.safeParse(value).success).toBe(false);
  }
});
