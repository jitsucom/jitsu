import { describe, expect, it } from "vitest";
import { mapReverseRow, mappedColumns } from "../src/reverse-etl/mapping";
import { objectMappingErrors, resolveStreamEditor, streamRequirementErrors } from "../src/reverse-etl/editor";
import { reverseDestinationMetadata } from "../src/reverse-etl/catalog";

const google = reverseDestinationMetadata.get("google-ads")!.streams.find(s => s.id === "click-conversions")!;
const meta = reverseDestinationMetadata.get("facebook-conversions")!.streams.find(s => s.id === "conversions")!;

describe("object composition", () => {
  it("preserves model types and literal names without mutating source rows", () => {
    const source = { amount: 12, flag: false, empty: null, nested: { value: "x" }, first: "Ann" };
    const options = {
      mapping: { value: "amount" },
      objectMappings: { customData: { enabled: "flag", empty: "empty", nested: "nested", "a.b": "first" } },
    };
    expect(mapReverseRow(source, options)).toEqual({
      value: 12,
      customData: { enabled: false, empty: null, nested: { value: "x" }, "a.b": "Ann" },
    });
    expect(mappedColumns(options)).toEqual(["amount", "flag", "empty", "nested", "first"]);
    expect(source).not.toHaveProperty("customData");
  });
  it("keeps whole-object columns and strings unchanged, and omits empty optional compositions", () => {
    expect(
      mapReverseRow(
        { obj: { a: 1 }, text: '{"a":1}' },
        { mapping: { object: "obj", text: "text" }, objectMappings: { empty: {} } }
      )
    ).toEqual({ object: { a: 1 }, text: '{"a":1}' });
  });
  it("rejects ambiguous modes and missing composed source columns without values in the error", () => {
    expect(() =>
      mapReverseRow({}, { mapping: {}, objectMappings: { customData: { value: "secret_column" } } })
    ).toThrow("A mapped model column is missing");
    expect(() =>
      mapReverseRow({ a: {} }, { mapping: { customData: "a" }, objectMappings: { customData: { b: "a" } } })
    ).toThrow("either a model column or object composition");
  });
  it("accepts only provider-declared object mappings and properties", () => {
    const options = {
      ...google.defaults(),
      objectMappings: { sessionAttributes: { gadSource: "source" }, customVariables: { tier: "tier" } },
    };
    expect(objectMappingErrors(google, options)).toEqual([]);
    expect(objectMappingErrors(google, { ...options, objectMappings: { value: { x: "x" } } })).toHaveLength(1);
    expect(
      objectMappingErrors(google, { ...options, objectMappings: { sessionAttributes: { typo: "x" } } })
    ).toHaveLength(1);
    expect(objectMappingErrors(google, { ...options, mapping: { customVariables: "json" } })).toHaveLength(1);
  });
  it("requires all known app-data properties and counts complete compositions as configured", () => {
    const options = {
      ...meta.defaults(),
      streamOptions: { pixelId: "123", actionSource: "app", eventName: "Lead" },
      mapping: { email: "email", eventTime: "time" },
      objectMappings: { appData: { advertiser_tracking_enabled: "tracking" } },
    };
    expect(objectMappingErrors(meta, options)).toHaveLength(2);
    expect(resolveStreamEditor(meta, options).required.find(f => f.key === "mapping:appData")?.configured).toBe(false);
    options.objectMappings.appData = {
      advertiser_tracking_enabled: "tracking",
      application_tracking_enabled: "app_tracking",
      extinfo: "info",
    } as typeof options.objectMappings.appData;
    expect(objectMappingErrors(meta, options)).toEqual([]);
    expect(resolveStreamEditor(meta, options).required.find(f => f.key === "mapping:appData")?.configured).toBe(true);
  });
  it("does not let unrelated composed custom data satisfy Purchase value and currency", () => {
    const options = {
      ...meta.defaults(),
      streamOptions: { pixelId: "123", actionSource: "other", eventName: "Purchase" },
      mapping: { email: "email", eventTime: "time" },
      objectMappings: { customData: { unrelated: "x" } },
    };
    expect(streamRequirementErrors(meta, options).some(e => e.startsWith("Purchase value"))).toBe(true);
    const complete = { ...options, objectMappings: { customData: { value: "amount", currency: "currency" } } };
    expect(streamRequirementErrors(meta, complete).some(e => e.startsWith("Purchase value"))).toBe(false);
    const mixed = {
      ...options,
      mapping: { ...options.mapping, currency: "currency" },
      objectMappings: { customData: { value: "amount" } },
    };
    expect(streamRequirementErrors(meta, mixed).some(e => e.startsWith("Purchase value"))).toBe(false);
  });
});
