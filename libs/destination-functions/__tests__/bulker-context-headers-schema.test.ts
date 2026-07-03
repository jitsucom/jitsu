import { BULKER_JSON_DATA_TYPE, withContextHeadersSchema } from "../src/functions/bulker-destination";

const eventWithHeaders = { context: { headers: { "user-agent": "Mozilla/5.0" } } };

test("adds context_headers schema field for segment layouts and passthrough", () => {
  for (const layout of ["segment", "segment-single-table", "passthrough"] as const) {
    const result = withContextHeadersSchema(undefined, layout, eventWithHeaders);
    expect(result.schema.fields).toEqual([{ name: "context_headers", type: BULKER_JSON_DATA_TYPE }]);
  }
});

test("does not touch jitsu-legacy layout", () => {
  expect(withContextHeadersSchema(undefined, "jitsu-legacy", eventWithHeaders)).toBeUndefined();
  const streamOptions = { deduplicate: true };
  expect(withContextHeadersSchema(streamOptions, "jitsu-legacy", eventWithHeaders)).toBe(streamOptions);
});

test("does not add schema when the event has no context.headers object", () => {
  const streamOptions = { deduplicate: true };
  for (const event of [
    {},
    { context: {} },
    { context: { headers: null } },
    { context: { headers: "user-agent: curl" } },
    { context: { headers: ["user-agent"] } },
  ]) {
    expect(withContextHeadersSchema(streamOptions, "segment-single-table", event)).toBe(streamOptions);
  }
});

test("preserves existing streamOptions and schema fields", () => {
  const streamOptions = {
    deduplicate: true,
    schema: { name: "events", fields: [{ name: "custom", type: 4 }] },
  };
  const result = withContextHeadersSchema(streamOptions, "segment-single-table", eventWithHeaders);
  expect(result.deduplicate).toBe(true);
  expect(result.schema.name).toBe("events");
  expect(result.schema.fields).toEqual([
    { name: "custom", type: 4 },
    { name: "context_headers", type: BULKER_JSON_DATA_TYPE },
  ]);
  // input is not mutated
  expect(streamOptions.schema.fields).toHaveLength(1);
});

test("leaves malformed schema.fields untouched instead of throwing", () => {
  for (const fields of ["not-an-array", { name: "x" }, 42, null]) {
    const streamOptions = { schema: { fields } };
    expect(withContextHeadersSchema(streamOptions, "segment", eventWithHeaders)).toBe(streamOptions);
  }
});

test("leaves non-object schema untouched (bulker accepts schema as a JSON string)", () => {
  for (const schema of ['{"fields": [{"name": "custom", "type": 4}]}', 42, [], null]) {
    const streamOptions = { schema };
    expect(withContextHeadersSchema(streamOptions, "segment", eventWithHeaders)).toBe(streamOptions);
  }
});

test("does not duplicate an existing context_headers field", () => {
  const streamOptions = { schema: { fields: [{ name: "context_headers", type: 4 }] } };
  expect(withContextHeadersSchema(streamOptions, "segment", eventWithHeaders)).toBe(streamOptions);
});
