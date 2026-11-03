import { expect, it } from "vitest";
import { ModelDefinition, PreviewRequest } from "./schema";
import { transformNestedObjects, transformNestedPreview } from "./nested-objects";
import { decodeRecord, previewModelRows } from "./reader";
import { keyCountColumn } from "./sql";
import type { WarehouseReader } from "./types";

const row = {
  id: "9007199254740993",
  profile: { name: "Alice", address: { city: "NY" }, empty: {}, missing: null },
  items: [{ value: 1 }, null],
  missing: null,
  text: '{"looks":"like JSON"}',
};

it("defaults old models and preview requests to leaveAsIs and rejects invalid modes", () => {
  const input = { warehouseId: "wh", query: "SELECT id FROM source", primaryKey: ["id"] };
  expect(ModelDefinition.parse(input).nestedObjects).toBe("leaveAsIs");
  expect(PreviewRequest.parse(input).nestedObjects).toBe("leaveAsIs");
  expect(() => ModelDefinition.parse({ ...input, nestedObjects: "other" })).toThrow();
});

it("leaves decoded values intact by default", () => {
  expect(transformNestedObjects(row)).toBe(row);
});

it("flattens objects, preserving arrays, nulls, empty objects, scalars and input", () => {
  const before = structuredClone(row);
  expect(transformNestedObjects(row, "flatten")).toEqual({
    id: row.id,
    profile_name: "Alice",
    profile_address_city: "NY",
    profile_empty: {},
    profile_missing: null,
    items: row.items,
    missing: null,
    text: row.text,
  });
  expect(row).toEqual(before);
});

it("stringifies only object/array cells, not nulls, JSON primitives or ordinary text", () => {
  expect(transformNestedObjects({ ...row, bool: true, number: 42 }, "stringify")).toEqual({
    ...row,
    profile: JSON.stringify(row.profile),
    items: JSON.stringify(row.items),
    bool: true,
    number: 42,
  });
});

it.each([
  { a: { b: 1 }, a_b: 2 },
  { a_b: null, a: { b: 1 } },
  { a: { b: { c: 1 } }, a_b: {} },
  { a: { b_c: 1, b: { c: 2 } } },
])("fails on ambiguous flattened names instead of overwriting values", input => {
  expect(() => transformNestedObjects(input, "flatten")).toThrow(/conflicting field names/);
});

it.each(["flatten", "stringify"] as const)("handles special keys safely in %s", mode => {
  const value = JSON.parse('{"__proto__":{},"constructor":{"prototype":{"polluted":true}}}');
  const transformed = transformNestedObjects(value, mode);
  expect(Object.hasOwn(transformed, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(transformed)).toBe(Object.prototype);
  expect(({} as any).polluted).toBeUndefined();
});

it("bounds recursive flattening", () => {
  let input: Record<string, unknown> = { value: 1 };
  for (let i = 0; i < 101; i++) input = { nested: input };
  expect(() => transformNestedObjects(input, "flatten")).toThrow(/depth limit/);
});

it.each(["leaveAsIs", "flatten", "stringify"] as const)(
  "keeps exact identity, cursor and delete semantics with %s",
  nestedObjects => {
    const model = ModelDefinition.parse({
      warehouseId: "wh",
      query: "SELECT * FROM source",
      primaryKey: ["id"],
      cursor: { column: "changed", type: "number" },
      deleteColumn: "deleted",
      nestedObjects,
    });
    const payload = { ...row, changed: "9007199254740994", deleted: true };
    expect(decodeRecord(model, { ...payload, [keyCountColumn]: "1" })).toEqual({
      row: transformNestedObjects(payload, nestedObjects),
      deleted: true,
      checkpoint: { value: "9007199254740994", primaryKeyValues: [row.id] },
    });
    expect(() => decodeRecord(model, { ...payload, [keyCountColumn]: "2" })).toThrow(/duplicate primary keys/);
    expect(() => decodeRecord(model, { ...payload, id: { value: 1 }, [keyCountColumn]: "1" })).toThrow(/scalar/);
  }
);

it("discovers the union of sampled leaves and keeps SQL columns separate", () => {
  const preview = {
    columns: [
      { name: "id", type: "20" },
      { name: "obj", type: "3802" },
    ],
    rows: [
      { id: "1", obj: { a: null } },
      { id: "2", obj: { a: "x", b: [1] } },
    ],
    truncated: true,
  };
  const result = transformNestedPreview(preview, "flatten");
  expect(result.sourceColumns).toEqual(preview.columns);
  expect(result.columns).toEqual([
    { name: "id", type: "20" },
    { name: "obj_a", type: "string", supportsDelete: false },
    { name: "obj_b", type: "array", supportsDelete: false },
  ]);
  expect(result.truncated).toBe(true);
  expect(result.rows).toEqual([
    { id: "1", obj_a: null },
    { id: "2", obj_a: "x", obj_b: [1] },
  ]);
  expect(transformNestedPreview({ ...preview, rows: [] }, "flatten").columns).toEqual(preview.columns);
  expect(transformNestedPreview(preview, "stringify").columns).toEqual([
    { name: "id", type: "20" },
    { name: "obj", type: "string", supportsDelete: false },
  ]);
});

it("rechecks the preview byte limit after transformation", async () => {
  const reader = {
    sql: { supportsDeleteType: () => false },
    preview: async () => ({
      columns: [{ name: "obj", type: "json" }],
      rows: [{ obj: { text: '"'.repeat(600_000) } }],
      truncated: false,
    }),
  } as unknown as WarehouseReader;
  await expect(previewModelRows(reader, "SELECT obj", "leaveAsIs")).resolves.toBeDefined();
  await expect(previewModelRows(reader, "SELECT obj", "stringify")).rejects.toThrow(/2 MB/);
});
