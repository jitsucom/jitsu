import { describe, expect, it } from "vitest";
import type { ReverseEditorOptions } from "@jitsu/protocols/reverse-etl-editor";
import { reverseDestinationMetadata } from "../src/reverse-etl/catalog";
import { editorFieldKey, resolveStreamEditor } from "../src/reverse-etl/editor";
import { MetaActionSource } from "../src/functions/facebook/reverse-meta";

function editor(destination: string, stream: string) {
  return reverseDestinationMetadata.get(destination)!.streams.find(s => s.id === stream)!;
}
function form(destination: string, stream: string, patch: Partial<ReverseEditorOptions> = {}) {
  const definition = editor(destination, stream);
  const options = { ...definition.defaults(), ...patch };
  return resolveStreamEditor(definition, options);
}
const keys = (fields: { key: string }[]) => fields.map(f => f.key);
const all = (result: ReturnType<typeof form>) => [...result.required, ...result.alternativeFields, ...result.optional];

describe("requirements for every supported stream", () => {
  it.each([
    [
      "google-ads",
      "audience",
      ["setting:Audience name", "setting:Customer Match terms", "setting:Exclusive management"],
    ],
    ["google-ads", "click-conversions", ["setting:Conversion action ID", "mapping:conversionTimestamp"]],
    ["google-ads", "call-conversions", ["mapping:callerId", "mapping:callTimestamp", "mapping:conversionTimestamp"]],
    ["google-ads", "conversion-adjustments", ["mapping:orderId"]],
    [
      "facebook-conversions",
      "audience",
      ["setting:Ad account ID", "setting:Audience name", "setting:Exclusive management"],
    ],
    ["facebook-conversions", "conversions", ["setting:pixelId", "mapping:eventSourceUrl", "mapping:clientUserAgent"]],
    ["microsoft-ads", "audience", ["mapping:email", "setting:Exclusive management"]],
    ["microsoft-ads", "offline-conversions", ["setting:Conversion goal name", "mapping:conversionTime"]],
    ["webhook", "rows", ["setting:Payload", "setting:Repeated delivery"]],
  ])("%s / %s exposes required fields", (destination, stream, required) => {
    expect(keys(form(destination as string, stream as string).required)).toEqual(
      expect.arrayContaining(required as string[])
    );
  });

  it("all alternatives reference real, unique controls in all selector variants", () => {
    for (const metadata of reverseDestinationMetadata.values())
      for (const stream of metadata.streams) {
        const defaults = stream.defaults();
        const variants = [
          defaults,
          ...[
            { api: "google-ads" },
            { adjustmentType: "RESTATEMENT" },
            { adjustmentType: "RETRACTION" },
            { identifierType: "MOBILE_ADVERTISING_ID" },
            { identifierType: "CRM_ID" },
            { actionSource: "app" },
            { actionSource: "business_messaging", messagingChannel: "instagram" },
            { eventName: "Purchase" },
            { valueBased: true },
          ].map(settings => ({ ...defaults, streamOptions: { ...defaults.streamOptions, ...settings } })),
          {
            ...defaults,
            mapping: {
              adjustmentType: "type",
              actionSource: "source",
              messagingChannel: "channel",
              eventName: "event",
            },
          },
        ];
        for (const options of variants) {
          const fields = stream.fields(options);
          const fieldKeys = fields.map(editorFieldKey);
          expect(new Set(fieldKeys).size).toBe(fieldKeys.length);
          for (const group of stream.alternatives?.(options) ?? []) {
            if (group.when && !group.when(options)) continue;
            for (const option of group.options)
              for (const key of option.fields)
                expect(fieldKeys, `${metadata.id}/${stream.id}/${group.key}`).toContain(key);
          }
          const result = resolveStreamEditor(stream, options);
          expect(new Set(keys(all(result))).size).toBe(all(result).length);
        }
      }
  });
});

it("Google contact matching accepts email OR phone OR all address parts, without making each mandatory", () => {
  const check = (mapping: Record<string, string>) => form("google-ads", "audience", { mapping });
  expect(check({}).alternatives[0].configured).toBe(false);
  expect(check({ hashedEmail: "email_hash" }).alternatives[0].configured).toBe(true);
  expect(check({ firstName: "first", lastName: "last", countryCode: "country" }).alternatives[0].configured).toBe(
    false
  );
  expect(
    check({ firstName: "first", hashedLastName: "last", countryCode: "country", postalCode: "zip" }).alternatives[0]
      .configured
  ).toBe(true);
  expect(keys(check({ email: "e", phone: "p" }).required)).not.toContain("mapping:email");
});

it("switching Google identifier families preserves mappings for explicit cleanup", () => {
  const stream = editor("google-ads", "audience");
  const initial = { ...stream.defaults(), mapping: { email: "email" } };
  const selector = stream.fields(initial).find(f => f.name === "Identifier type")!;
  if (selector.editor !== "select") throw new Error("selector expected");
  const changed = { ...initial, ...selector.change("CRM_ID") };
  expect(changed.mapping).toEqual(initial.mapping);
  const result = resolveStreamEditor(stream, changed);
  expect(keys(result.required)).toContain("mapping:crmId");
  expect(result.alternatives).toHaveLength(0);
  expect(result.optional.find(f => f.key === "mapping:email")).toMatchObject({ isHidden: true, configured: true });
});

it("Google mobile app settings are required only when creating the audience", () => {
  for (const kind of ["managed", "existing"]) {
    const result = form("google-ads", "audience", {
      streamOptions: { identifierType: "MOBILE_ADVERTISING_ID", audience: { kind } },
    });
    expect(keys(result.required).includes("setting:App ID")).toBe(kind === "managed");
    expect(keys(result.required)).toContain("mapping:mobileAdvertisingId");
    expect(keys(all(result))).not.toContain("mapping:email");
  }
});

it("Google API selection hides incompatible empty fields but surfaces saved mappings", () => {
  const ads = form("google-ads", "click-conversions", {
    streamOptions: { api: "google-ads" },
    mapping: { firstName: "first" },
  });
  expect(keys(all(ads))).not.toContain("mapping:postalCode");
  expect(ads.optional.find(f => f.key === "mapping:firstName")?.isHidden).toBe(true);
  expect(keys(all(ads))).toContain("mapping:merchantCountryCode");
  expect(keys(all(form("google-ads", "click-conversions")))).not.toContain("mapping:merchantCountryCode");
  expect(keys(all(ads))).not.toContain("mapping:userAgent");
});

it.each(["ENHANCEMENT", "RESTATEMENT", "RETRACTION"])(
  "adjustment type %s selects requirements; mapped type keeps all branches",
  adjustmentType => {
    const fixed = form("google-ads", "conversion-adjustments", { streamOptions: { adjustmentType } });
    expect(keys(fixed.required).includes("mapping:orderId")).toBe(adjustmentType === "ENHANCEMENT");
    expect(keys(fixed.required).includes("mapping:restatementValue")).toBe(adjustmentType === "RESTATEMENT");
    expect(keys(all(fixed)).includes("mapping:email")).toBe(adjustmentType === "ENHANCEMENT");
    const dynamic = form("google-ads", "conversion-adjustments", {
      streamOptions: { adjustmentType },
      mapping: { adjustmentType: "kind" },
    });
    expect(keys(all(dynamic))).toEqual(
      expect.arrayContaining([
        "mapping:email",
        "mapping:restatementValue",
        "mapping:gclid",
        "mapping:conversionTimestamp",
      ])
    );
    expect(keys(dynamic.required)).not.toContain("mapping:restatementValue");
    expect(dynamic.alternatives.every(group => !!group.condition)).toBe(true);
  }
);

it("original conversion alternatives require both GCLID and conversion time", () => {
  const check = (mapping: Record<string, string>) =>
    form("google-ads", "conversion-adjustments", { mapping, streamOptions: { adjustmentType: "RETRACTION" } })
      .alternatives[0].configured;
  expect(check({ gclid: "click" })).toBe(false);
  expect(check({ gclid: "click", conversionTimestamp: "time" })).toBe(true);
  expect(check({ orderId: "id" })).toBe(true);
});

it("Meta value-based audiences and page-scoped matching activate dependencies", () => {
  const result = form("facebook-conversions", "audience", {
    mapping: { pageScopedUserId: "psid" },
    streamOptions: { valueBased: true },
  });
  expect(keys(result.required)).toEqual(expect.arrayContaining(["mapping:lookalikeValue", "setting:pageId"]));
  expect(result.alternatives[0].configured).toBe(true);
  const hidden = form("facebook-conversions", "audience", { mapping: { lookalikeValue: "value" } });
  expect(hidden.optional.find(f => f.key === "mapping:lookalikeValue")?.isHidden).toBe(true);
});

it("Meta event name accepts a default or mapping and Purchase accepts custom data", () => {
  const result = form("facebook-conversions", "conversions", {
    mapping: { customData: "json", email: "email" },
    streamOptions: { eventName: "Purchase" },
  });
  expect(result.alternatives.find(g => g.key === "event")?.configured).toBe(true);
  expect(result.alternatives.find(g => g.key === "purchase")?.configured).toBe(true);
  expect(keys(result.required)).not.toContain("mapping:value");
  const dynamic = form("facebook-conversions", "conversions", { mapping: { eventName: "name" } });
  expect(dynamic.alternatives.find(g => g.key === "purchase")?.condition).toBe("For Purchase rows");
});

it("Meta action source is the first alternative and keeps all conversion fields visible", () => {
  const defaults = form("facebook-conversions", "conversions");
  const expected = keys(all(defaults)).sort();
  for (const actionSource of MetaActionSource.options)
    for (const mapping of [{}, { actionSource: "source" }]) {
      const result = form("facebook-conversions", "conversions", { streamOptions: { actionSource }, mapping });
      expect(result.alternatives[0]).toMatchObject({
        key: "action-source",
        configured: true,
        options: [{ fields: ["setting:Default action source"] }, { fields: ["mapping:actionSource"] }],
      });
      expect(keys(result.required)).not.toContain("setting:Default action source");
      expect(keys(result.alternativeFields)).toEqual(
        expect.arrayContaining(["setting:Default action source", "mapping:actionSource"])
      );
      expect(keys(all(result)).sort()).toEqual(expected);
      expect(all(result).some(field => field.isHidden)).toBe(false);
    }
});

it.each([
  ["website", undefined, ["eventSourceUrl", "clientUserAgent"]],
  ["app", undefined, ["appData"]],
  ["business_messaging", "messenger", ["pageId", "pageScopedUserId"]],
  ["business_messaging", "whatsapp", ["whatsappBusinessAccountId", "ctwaClid"]],
  ["business_messaging", "instagram", ["instagramAccountId", "instagramScopedId"]],
])(
  "Meta %s / %s requires its own fields without hiding dynamic branches",
  (actionSource, messagingChannel, required) => {
    const streamOptions = { actionSource, messagingChannel };
    const fixed = form("facebook-conversions", "conversions", { streamOptions });
    expect(keys(fixed.required)).toEqual(expect.arrayContaining((required as string[]).map(k => `mapping:${k}`)));
    const dynamic = form("facebook-conversions", "conversions", {
      streamOptions,
      mapping: { actionSource: "source", messagingChannel: "channel" },
    });
    expect(keys(all(dynamic))).toContain("setting:Default messaging channel");
    expect(keys(all(dynamic))).toContain("mapping:appData");
    expect(keys(dynamic.required)).not.toContain("mapping:clientUserAgent");
    expect(keys(dynamic.required)).not.toContain("mapping:pageId");
  }
);

it("Meta user agent/account IDs alone do not satisfy matching", () => {
  const result = form("facebook-conversions", "conversions", {
    mapping: { clientUserAgent: "ua", pageId: "page", instagramAccountId: "ig" },
  });
  expect(result.alternatives.find(g => g.key === "matching")?.configured).toBe(false);
});

it("Microsoft conversion attribution fields are paired, and terms remain optional", () => {
  const result = form("microsoft-ads", "offline-conversions", {
    mapping: { externalAttributionCredit: "credit", hashedPhone: "phone" },
  });
  expect(keys(result.required)).toContain("mapping:externalAttributionModel");
  expect(result.alternatives[0].configured).toBe(true);
  expect(keys(form("microsoft-ads", "audience").required)).not.toContain("setting:Customer Match terms");
});

it("Webhook HTTP acknowledgement depends only on destination protocol; resolution never mutates options", () => {
  for (const protocol of ["http:", "https:", undefined]) {
    const stream = editor("webhook", "rows");
    const options = { ...stream.defaults(), destination: { protocol } };
    const before = JSON.stringify(options);
    const result = resolveStreamEditor(stream, options);
    expect(keys(result.required).includes("setting:Unencrypted HTTP")).toBe(protocol === "http:");
    expect(keys(all(result)).includes("setting:Unencrypted HTTP")).toBe(protocol !== "https:");
    expect(JSON.stringify(options)).toBe(before);
  }
});
