import { idToSnakeCaseFast, idToSnakeCaseRegex } from "../src/functions/lib/strings";

const data: Record<string, string> = {
  // must be not touched
  plain: "plain",
  plain_: "plain_",
  _plain: "_plain",
  _plain_string: "_plain_string",
  _plain__string: "_plain__string",

  // simple
  camelCase: "camel_case",
  camelCaseA: "camel_case_a",
  cCase: "c_case",

  // node adding '_' before first
  Camel: "camel",
  CamelCase: "camel_case",
  CCamel: "c_camel",
  CCamelCase: "c_camel_case",

  // abbreviations. not fixed yet
  camelUSCase: "camel_u_s_case",
  camelCaseEU: "camel_case_e_u",

  // not adding extra '_' if already exists
  _CamelCase: "_camel_case",
  __CamelCase: "__camel_case",
  Camel_Case: "camel_case",
  Camel__Case: "camel__case",

  // but not collapsing existing ones
  _camelCase: "_camel_case",
  camelCase_: "camel_case_",
  camelCase__: "camel_case__",
  __camelCase: "__camel_case",
};

const dataWithSpaces: Record<string, string> = {
  " CamelCase": "_camel_case",
  "  CamelCase": "__camel_case",
  "Camel Case": "camel_case",
  "Camel case": "camel_case",
  "Camel  Case": "camel__case",
  "Camel Case ": "camel_case_",
  "Camel Case  ": "camel_case__",
  "Camel _ Case": "camel___case",
  "Camel_ _Case": "camel___case",
  "_ CamelCase _": "__camel_case__",
  " _CamelCase_ ": "__camel_case__",
};

test("test idToSnakeCaseFast", async () => {
  for (const [value, expected] of Object.entries(data)) {
    const res = idToSnakeCaseFast(value);
    expect(res).toEqual(expected);
  }
});

test("test idToSnakeCaseFast with spaces", async () => {
  for (const [value, expected] of Object.entries(dataWithSpaces)) {
    const res = idToSnakeCaseFast(value);
    expect(res).toEqual(expected);
  }
});

test("test idToSnakeCaseRegex", async () => {
  for (const [value, expected] of Object.entries(data)) {
    const res = idToSnakeCaseRegex(value);
    expect(res).toEqual(expected);
  }
});
