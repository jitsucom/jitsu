import { expect, it } from "vitest";
import { reverseSyncSchema } from "../../lib/server/reverse-etl-schema";

it("discovers every supported stream with serializable requirements and composition metadata", () => {
  const destinations = reverseSyncSchema();
  expect(destinations.map((d: any) => d.destinationType)).toEqual(
    expect.arrayContaining(["google-ads", "facebook-conversions", "microsoft-ads", "webhook", "openai-ads"])
  );
  for (const destination of destinations) {
    for (const stream of destination.streams) {
      const result = reverseSyncSchema(destination.destinationType, stream.id);
      expect(result.streams).toHaveLength(1);
      expect(result.streams[0]).toMatchObject({
        id: stream.id,
        streamOptionsSchema: expect.any(Object),
        required: expect.any(Array),
        alternatives: expect.any(Array),
      });
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    }
  }
  const click = reverseSyncSchema("google-ads", "click-conversions").streams[0];
  expect(click.optional.find((f: any) => f.field === "customVariables").object.additionalProperties).toBe(true);
  expect(click.alternatives.length).toBeGreaterThan(0);
  expect(() => reverseSyncSchema("unknown")).toThrow(/does not support/);
  expect(() => reverseSyncSchema("google-ads", "unknown")).toThrow(/Unknown/);
});

it("evaluates selector-driven requirements using current selections", () => {
  const base = reverseSyncSchema("facebook-conversions", "conversions").streams[0];
  const app = reverseSyncSchema("facebook-conversions", "conversions", { streamOptions: { actionSource: "app" } })
    .streams[0];
  expect(base.required.some((f: any) => f.field === "appData")).toBe(false);
  expect(app.required.some((f: any) => f.field === "appData")).toBe(true);
  expect(app.required.find((f: any) => f.field === "appData").isRequired).toBe(true);
  const configured = reverseSyncSchema("google-ads", "audience", { mapping: { email: "customer_email" } }).streams[0];
  expect(configured.alternatives.some((g: any) => g.configured)).toBe(true);
});
