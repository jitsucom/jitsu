import { expect, it } from "vitest";
import { displayColumnType } from "../../lib/warehouse-column-type";

it.each([
  ["16", "boolean"],
  ["20", "bigint"],
  ["21", "smallint"],
  ["23", "integer"],
  ["25", "text"],
  ["700", "real"],
  ["701", "double precision"],
  ["1082", "date"],
  ["1114", "timestamp without time zone"],
  ["1184", "timestamp with time zone"],
  ["1700", "numeric"],
  ["2950", "uuid"],
  ["114", "json"],
  ["3802", "jsonb"],
  ["1000", "boolean[]"],
  ["1009", "text[]"],
  ["1016", "bigint[]"],
  ["1231", "numeric[]"],
  ["1185", "timestamp with time zone[]"],
  ["199", "json[]"],
  ["3807", "jsonb[]"],
])("displays OID %s as %s", (oid, name) => {
  expect(displayColumnType(oid)).toBe(name);
});

it.each(["String", "Nullable(Int64)", "STRUCT<id INT64>", "ARRAY<STRING>", "DECIMAL(10,2)", "custom_type"])(
  "preserves a warehouse-provided type name: %s",
  name => expect(displayColumnType(name)).toBe(name)
);

it("does not invent a type name for an unknown OID", () => {
  expect(displayColumnType("999999")).toBe("");
});
