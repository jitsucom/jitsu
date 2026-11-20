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

describe("a choice (oneOf) whose discriminator still holds the mask", () => {
  // the shape of a tunnel method or a replication method in a connector spec
  const choiceSpec = {
    type: "object",
    required: ["host"],
    properties: {
      host: { type: "string" },
      tunnel_method: {
        type: "object",
        oneOf: [
          {
            title: "No tunnel",
            required: ["tunnel_method"],
            properties: { tunnel_method: { type: "string", const: "NO_TUNNEL" } },
          },
          {
            title: "SSH key",
            required: ["tunnel_method", "tunnel_host", "ssh_key"],
            properties: {
              tunnel_method: { type: "string", const: "SSH_KEY_AUTH" },
              tunnel_host: { type: "string" },
              ssh_key: { type: "string", airbyte_secret: true },
            },
          },
        ],
      },
    },
  };
  const validatorOf = () => new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(choiceSpec);

  it("does not block a save: the group stands for the saved values", () => {
    const credentials: any = { host: MASKED_SECRET, tunnel_method: { tunnel_method: MASKED_SECRET } };
    const plain = validatorOf();
    plain(JSON.parse(JSON.stringify(credentials)));
    expect(plain.errors!.some(e => e.keyword === "oneOf")).toBe(true); // Ajv does report it
    expect(validateKeepingMasks(validatorOf(), credentials)).toEqual([]);
  });

  it("does not block a save when the other fields of the group are masked too", () => {
    const credentials: any = {
      host: "db.example",
      tunnel_method: { tunnel_method: MASKED_SECRET, tunnel_host: MASKED_SECRET, ssh_key: MASKED_SECRET },
    };
    expect(validateKeepingMasks(validatorOf(), credentials)).toEqual([]);
  });

  it("still reports a chosen option that is incomplete", () => {
    const credentials: any = {
      host: "db.example",
      tunnel_method: { tunnel_method: "SSH_KEY_AUTH", ssh_key: MASKED_SECRET },
    };
    const kept = validateKeepingMasks(validatorOf(), credentials);
    expect(kept.some(e => e.keyword === "required" && e.instancePath === "/tunnel_method")).toBe(true);
  });

  it("still reports an error elsewhere while the group is masked", () => {
    const credentials: any = { tunnel_method: { tunnel_method: MASKED_SECRET } };
    const kept = validateKeepingMasks(validatorOf(), credentials);
    expect(kept.map(e => e.instancePath + " " + e.keyword)).toEqual([" required"]);
  });

  it("still reports a typed field inside a masked choice that does not fit", () => {
    const withPort = {
      ...choiceSpec,
      properties: {
        ...choiceSpec.properties,
        tunnel_method: {
          ...choiceSpec.properties.tunnel_method,
          oneOf: choiceSpec.properties.tunnel_method.oneOf.map((o: any) => ({
            ...o,
            properties: { ...o.properties, tunnel_port: { type: "integer" } },
          })),
        },
      },
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(withPort);
    const credentials: any = { host: "h", tunnel_method: { tunnel_method: MASKED_SECRET, tunnel_port: "abc" } };
    const kept = validateKeepingMasks(validate, credentials);
    expect(kept.map(e => e.instancePath).sort()).toContain("/tunnel_method/tunnel_port");
    expect(kept.some(e => e.keyword === "oneOf" && e.instancePath === "/tunnel_method")).toBe(false);
  });

  it("still reports a typed field next to a masked discriminator when the choice is the whole object", () => {
    const rootChoice = {
      anyOf: [
        { properties: { kind: { const: "a" }, port: { type: "integer" } } },
        { properties: { kind: { const: "b" }, port: { type: "integer" } } },
      ],
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(rootChoice);
    expect(validateKeepingMasks(validate, { kind: MASKED_SECRET, port: 5 })).toEqual([]);
    const kept = validateKeepingMasks(validate, { kind: MASKED_SECRET, port: "abc" });
    expect(kept.map(e => e.instancePath)).toContain("/port");
  });

  it("ignores the errors of the branches the saved value does not belong to", () => {
    // two modes that allow different ports: the saved mode is hidden, an unchanged port fits one of them
    const rangeChoice = {
      anyOf: [
        { properties: { kind: { const: "a" }, port: { type: "integer", maximum: 10 } } },
        { properties: { kind: { const: "b" }, port: { type: "integer", minimum: 100 } } },
      ],
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(rangeChoice);
    expect(validateKeepingMasks(validate, { kind: MASKED_SECRET, port: 150 })).toEqual([]);
    expect(validateKeepingMasks(validate, { kind: MASKED_SECRET, port: 5 })).toEqual([]);
    // fits neither mode: the typed value is wrong whatever the saved mode is
    const kept = validateKeepingMasks(validate, { kind: MASKED_SECRET, port: 50 });
    expect(kept.map(e => e.instancePath)).toEqual(["/port", "/port"]);
    expect(kept.map(e => e.keyword).sort()).toEqual(["maximum", "minimum"]);
  });

  it("does the same for a choice inside an object, next to a field that is wrong whatever the mode is", () => {
    const nested = {
      type: "object",
      properties: {
        tunnel: {
          type: "object",
          oneOf: [
            { properties: { mode: { const: "a" }, port: { type: "integer", maximum: 10 } } },
            { properties: { mode: { const: "b" }, port: { type: "integer", minimum: 100 } } },
          ],
        },
        timeout: { type: "integer" },
      },
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(nested);
    expect(validateKeepingMasks(validate, { tunnel: { mode: MASKED_SECRET, port: 150 }, timeout: 3 })).toEqual([]);
    const kept = validateKeepingMasks(validate, { tunnel: { mode: MASKED_SECRET, port: 150 }, timeout: "x" });
    expect(kept.map(e => e.instancePath)).toEqual(["/timeout"]);
  });

  it("tells the choice of row 1 from the choice of row 10: a pointer prefix is not a pointer ancestor", () => {
    const rows = {
      type: "object",
      properties: {
        rows: {
          type: "array",
          items: {
            oneOf: [
              { properties: { mode: { const: "a" }, port: { type: "integer", maximum: 10 } } },
              { properties: { mode: { const: "b" }, port: { type: "integer", minimum: 100 } } },
            ],
          },
        },
      },
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(rows);
    // every row is valid for one mode, row 10 for the other one than row 1
    const list = Array.from({ length: 12 }, (_, i) => ({ mode: MASKED_SECRET, port: i === 10 ? 5 : 150 }));
    expect(validateKeepingMasks(validate, { rows: list })).toEqual([]);
    // row 11 fits neither mode: it is reported, and only it
    list[11].port = 50;
    expect(validateKeepingMasks(validate, { rows: list }).map(e => e.instancePath)).toEqual([
      "/rows/11/port",
      "/rows/11/port",
    ]);
  });

  it("does not take an option that forbids a field the user supplied for one that fits", () => {
    const managed = {
      oneOf: [
        { additionalProperties: false, properties: { mode: { const: "managed" } } },
        { properties: { mode: { const: "manual" }, port: { type: "integer", minimum: 100 } } },
      ],
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(managed);
    // port 50 is wrong for manual, and managed does not take a port at all
    const kept = validateKeepingMasks(validate, { mode: MASKED_SECRET, port: 50 });
    expect(kept.some(e => e.instancePath === "/port" && e.keyword === "minimum")).toBe(true);
    // port 150 fits manual; no port fits managed
    expect(validateKeepingMasks(validate, { mode: MASKED_SECRET, port: 150 })).toEqual([]);
    expect(validateKeepingMasks(validate, { mode: MASKED_SECRET })).toEqual([]);
  });

  it("does not take a mask that sent a conditional to its other side for a reason a mode does not fit", () => {
    // the first mode takes ports up to 10 and, unless `mode` is "a", needs a key; the mask is not "a"
    const conditional = {
      oneOf: [
        {
          properties: { mode: { const: "a" }, port: { type: "integer", maximum: 10 } },
          if: { properties: { mode: { const: "a" } }, required: ["mode"] },
          then: {},
          else: { required: ["keyId"] },
        },
        { properties: { mode: { const: "b" }, port: { type: "integer", minimum: 100 } } },
      ],
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(conditional);
    expect(validateKeepingMasks(validate, { mode: MASKED_SECRET, port: 5 })).toEqual([]);
    expect(validateKeepingMasks(validate, { mode: MASKED_SECRET, port: 150 })).toEqual([]);
    const kept = validateKeepingMasks(validate, { mode: MASKED_SECRET, port: 50 });
    expect(kept.map(e => e.instancePath)).toContain("/port");
  });

  it("keeps a conditional that depends on a field the user can see, not on a mask", () => {
    // the first mode takes ports up to 10, and a key when `useKey` is true; the other mode takes ports from 100
    const visible = {
      oneOf: [
        {
          properties: {
            mode: { const: "a" },
            port: { type: "integer", maximum: 10 },
            useKey: { type: "boolean" },
          },
          if: { properties: { useKey: { const: true } }, required: ["useKey"] },
          then: { required: ["keyId"] },
        },
        { properties: { mode: { const: "b" }, port: { type: "integer", minimum: 100 } } },
      ],
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(visible);
    // useKey is true, there is no keyId, and port 5 does not fit the other mode: neither mode accepts it
    const kept = validateKeepingMasks(validate, { mode: MASKED_SECRET, useKey: true, port: 5 });
    expect(kept.length).toBeGreaterThan(0);
    // with a key the first mode accepts it
    expect(validateKeepingMasks(validate, { mode: MASKED_SECRET, useKey: true, keyId: "k", port: 5 })).toEqual([]);
    expect(validateKeepingMasks(validate, { mode: MASKED_SECRET, useKey: false, port: 5 })).toEqual([]);
  });

  it("sees a mask inside a nested field that the condition of an option reads", () => {
    const nested = {
      oneOf: [
        {
          properties: {
            mode: { const: "a" },
            settings: { type: "object" },
            port: { type: "integer", maximum: 10 },
          },
          if: {
            properties: { settings: { properties: { useDefaultKey: { const: true } }, required: ["useDefaultKey"] } },
          },
          then: {},
          else: { required: ["keyId"] },
        },
        { properties: { mode: { const: "b" }, port: { type: "integer", minimum: 100 } } },
      ],
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(nested);
    // the saved useDefaultKey is hidden: the mask sent the condition to its else, which is not the user's to fix
    expect(
      validateKeepingMasks(validate, { mode: MASKED_SECRET, settings: { useDefaultKey: MASKED_SECRET }, port: 5 })
    ).toEqual([]);
    // the same condition on a value the user can see is the user's
    const kept = validateKeepingMasks(validate, { mode: MASKED_SECRET, settings: { useDefaultKey: false }, port: 5 });
    expect(kept.length).toBeGreaterThan(0);
  });

  it("keeps a conditional that a visible field already decides, whatever the masked one is", () => {
    // the condition needs the provider to be "managed" (masked) and the key flag to be true (visible, and false)
    const decided = {
      oneOf: [
        {
          properties: {
            mode: { const: "a" },
            settings: { type: "object" },
            port: { type: "integer", maximum: 10 },
          },
          if: {
            properties: {
              settings: {
                properties: { provider: { const: "managed" }, useDefaultKey: { const: true } },
                required: ["provider", "useDefaultKey"],
              },
            },
          },
          then: {},
          else: { required: ["keyId"] },
        },
        { properties: { mode: { const: "b" }, port: { type: "integer", minimum: 100 } } },
      ],
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(decided);
    // useDefaultKey is false: no provider can make the condition true, the else needs a keyId that is missing, and port 5
    // does not fit the other mode
    const kept = validateKeepingMasks(validate, {
      mode: MASKED_SECRET,
      settings: { provider: MASKED_SECRET, useDefaultKey: false },
      port: 5,
    });
    expect(kept.length).toBeGreaterThan(0);
    // useDefaultKey is true: only the masked provider can decide, so the saved values may well be valid
    expect(
      validateKeepingMasks(validate, {
        mode: MASKED_SECRET,
        settings: { provider: MASKED_SECRET, useDefaultKey: true },
        port: 5,
      })
    ).toEqual([]);
  });

  it("treats a masked field that the condition only requires as present", () => {
    const optionA = {
      properties: { mode: { const: "a" }, port: { type: "integer", maximum: 10 } },
      // the provider is checked, the token only has to be there
      if: { properties: { provider: { const: "managed" } }, required: ["provider", "managedToken"] },
      then: {},
      else: { required: ["keyId"] },
    };
    const choice = {
      oneOf: [optionA, { properties: { mode: { const: "b" }, port: { type: "integer", minimum: 100 } } }],
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(choice);
    // provider and token are saved and hidden: with them the condition may well hold
    expect(
      validateKeepingMasks(validate, {
        mode: MASKED_SECRET,
        provider: MASKED_SECRET,
        managedToken: MASKED_SECRET,
        port: 5,
      })
    ).toEqual([]);
  });

  it("resolves a reference of a condition against the whole schema", () => {
    const root = {
      definitions: { region: { type: "string", enum: ["eu", "us"] } },
      oneOf: [
        {
          properties: { mode: { const: "a" }, port: { type: "integer", maximum: 10 } },
          if: {
            properties: { provider: { const: "managed" }, region: { $ref: "#/definitions/region" } },
            required: ["provider", "region"],
          },
          then: {},
          else: { required: ["keyId"] },
        },
        { properties: { mode: { const: "b" }, port: { type: "integer", minimum: 100 } } },
      ],
    };
    const validate = new Ajv({ allErrors: true, strictSchema: false, useDefaults: true }).compile(root);
    expect(
      validateKeepingMasks(validate, { mode: MASKED_SECRET, provider: MASKED_SECRET, region: "eu", port: 5 })
    ).toEqual([]);
    // a visible region that is not allowed makes the condition false whatever the provider is
    const kept = validateKeepingMasks(validate, {
      mode: MASKED_SECRET,
      provider: MASKED_SECRET,
      region: "asia",
      port: 5,
    });
    expect(kept.length).toBeGreaterThan(0);
  });

  it("keeps the errors when the compiled schema is not given: it cannot tell a choice from a field", () => {
    const credentials: any = { host: "db.example", tunnel_method: { tunnel_method: MASKED_SECRET } };
    const validate = validatorOf();
    validate(credentials);
    expect(withoutMaskedFieldErrors(validate.errors, credentials).length).toBeGreaterThan(0);
  });
});
