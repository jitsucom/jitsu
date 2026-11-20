import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { MASKED_SECRET } from "../../lib/schema/destinations";
import { validateKeepingMasks, withoutMaskedFieldErrors } from "../../lib/schema/masked-errors";

// JITSU-284: the editor keeps the credentials from the first response, where a missing spec masked every value (a port
// became a string), and checks them against the spec once it has arrived.

const spec = {
  type: "object",
  required: ["host", "port"],
  properties: {
    host: { type: "string" },
    port: { type: "integer" },
    ssl: { type: "boolean" },
    "a/b": { type: "integer" },
    nested: { type: "object", properties: { timeout: { type: "number" } } },
    rows: { type: "array", items: { type: "object", properties: { count: { type: "integer" } } } },
  },
};

function errorsOf(credentials: any) {
  const validate = new Ajv({ allErrors: true, strictSchema: false }).compile(spec);
  validate(credentials);
  return validate.errors ?? [];
}

describe("withoutMaskedFieldErrors", () => {
  it("drops the type errors of masked numbers and booleans, at any depth", () => {
    const credentials = {
      host: "db.example",
      port: MASKED_SECRET,
      ssl: MASKED_SECRET,
      "a/b": MASKED_SECRET,
      nested: { timeout: MASKED_SECRET },
      rows: [{ count: MASKED_SECRET }],
    };
    expect(errorsOf(credentials).length).toBe(5);
    expect(withoutMaskedFieldErrors(errorsOf(credentials), credentials)).toEqual([]);
  });

  it("keeps the error of a value the user typed that does not fit", () => {
    const credentials = { host: "db.example", port: "abc", ssl: MASKED_SECRET };
    const kept = withoutMaskedFieldErrors(errorsOf(credentials), credentials);
    expect(kept.map(e => e.instancePath)).toEqual(["/port"]);
  });

  it("keeps a missing required field and an error about the whole object", () => {
    const credentials = { port: MASKED_SECRET };
    const kept = withoutMaskedFieldErrors(errorsOf(credentials), credentials);
    expect(kept.map(e => e.keyword)).toEqual(["required"]);
    expect(withoutMaskedFieldErrors([{ instancePath: "" }], credentials)).toHaveLength(1);
  });

  it("copes with no errors at all", () => {
    expect(withoutMaskedFieldErrors(null, {})).toEqual([]);
    expect(withoutMaskedFieldErrors(undefined, {})).toEqual([]);
  });
});

describe("validateKeepingMasks", () => {
  // `timeout` has a default that only the branch for a mode other than "manual" inserts
  const conditional = {
    type: "object",
    properties: { mode: { enum: ["automatic", "manual"] }, name: { type: "string", default: "main" } },
    if: { properties: { mode: { const: "manual" } }, required: ["mode"] },
    then: { properties: { timeout: { type: "integer", default: 30 } } },
    else: { properties: { retries: { type: "integer", default: 5 } } },
  };
  const compile = () => new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(conditional);

  it("leaves the submitted credentials alone when they hold a mask, so no default of the wrong branch gets in", () => {
    const credentials: any = { mode: MASKED_SECRET };
    expect(validateKeepingMasks(compile(), credentials)).toEqual([]);
    expect(credentials).toEqual({ mode: MASKED_SECRET });
  });

  it("still fills in defaults, in place, when nothing is masked", () => {
    const credentials: any = { mode: "manual" };
    expect(validateKeepingMasks(compile(), credentials)).toEqual([]);
    expect(credentials).toEqual({ mode: "manual", name: "main", timeout: 30 });
  });

  it("reports an error about a typed value, and keeps ignoring the masked ones", () => {
    const errors = validateKeepingMasks(compile(), { mode: MASKED_SECRET, name: 5 });
    expect(errors.map(e => e.instancePath)).toEqual(["/name"]);
  });

  it("finds a mask inside a list or a nested object", () => {
    const nested: any = { mode: "manual", extra: [{ a: MASKED_SECRET }] };
    validateKeepingMasks(compile(), nested);
    expect(nested).toEqual({ mode: "manual", extra: [{ a: MASKED_SECRET }] });
  });
});
