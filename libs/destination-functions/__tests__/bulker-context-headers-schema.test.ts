import { BULKER_JSON_DATA_TYPE, withContextHeadersSchema } from "../src/functions/bulker-destination";

test("adds context_headers schema field for segment layouts and passthrough", () => {
  for (const layout of ["segment", "segment-single-table", "passthrough"] as const) {
    const result = withContextHeadersSchema(undefined, layout);
    expect(result.schema.fields).toEqual([{ name: "context_headers", type: BULKER_JSON_DATA_TYPE }]);
  }
});

test("does not touch jitsu-legacy layout", () => {
  expect(withContextHeadersSchema(undefined, "jitsu-legacy")).toBeUndefined();
  const streamOptions = { deduplicate: true };
  expect(withContextHeadersSchema(streamOptions, "jitsu-legacy")).toBe(streamOptions);
});

test("preserves existing streamOptions and schema fields", () => {
  const streamOptions = {
    deduplicate: true,
    schema: { name: "events", fields: [{ name: "custom", type: 4 }] },
  };
  const result = withContextHeadersSchema(streamOptions, "segment-single-table");
  expect(result.deduplicate).toBe(true);
  expect(result.schema.name).toBe("events");
  expect(result.schema.fields).toEqual([
    { name: "custom", type: 4 },
    { name: "context_headers", type: BULKER_JSON_DATA_TYPE },
  ]);
  // input is not mutated
  expect(streamOptions.schema.fields).toHaveLength(1);
});

test("does not duplicate an existing context_headers field", () => {
  const streamOptions = { schema: { fields: [{ name: "context_headers", type: 4 }] } };
  expect(withContextHeadersSchema(streamOptions, "segment")).toBe(streamOptions);
});
