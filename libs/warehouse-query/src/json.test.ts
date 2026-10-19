import { expect, it } from "vitest";
import { decodeJson } from "./reader";

it.each([
  ['{"profile":{"name":"Alice"},"items":[1,true,null]}', { profile: { name: "Alice" }, items: [1, true, null] }],
  ['{"id":9007199254740993}', { id: 9007199254740992 }],
  ['[1,{"x":2}]', [1, { x: 2 }]],
  ['"hello"', "hello"],
  ["true", true],
  ["42", 42],
  ["null", null],
  [null, null],
])("decodes warehouse JSON %s to native values", (wire, expected) => {
  expect(decodeJson(wire)).toEqual(expected);
});

it("does not include source values in invalid JSON errors", () => {
  expect(() => decodeJson('{"private":"sensitive')).toThrow(/^Warehouse returned invalid JSON in a structured column$/);
});

it.each(["1e400", '{"private":"sensitive","items":[-1e400]}'])(
  "rejects numeric overflow instead of serializing Infinity as null: %s",
  wire => {
    expect(() => decodeJson(wire)).toThrow(
      /^Warehouse JSON contains a number outside JavaScript's finite range; return it as a JSON string instead$/
    );
  }
);

it("keeps special property names as own data properties without prototype mutation", () => {
  const value = decodeJson('{"__proto__":{"polluted":true},"constructor":{"x":1}}');
  expect(Object.hasOwn(value as object, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  expect(({} as any).polluted).toBeUndefined();
});
