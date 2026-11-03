import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReverseStreamEditor } from "@jitsu/protocols/reverse-etl-editor";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import { applyMappingSuggestions, mappingTargets } from "../../lib/reverse-mapping-suggestions";
import { buildMappingQuestions, suggestWithJev } from "../../lib/server/jev-mapping";

const diagnostics = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("../../lib/server/log", () => ({
  getServerLog: () => ({ atInfo: () => diagnostics, atWarn: () => diagnostics, atError: () => diagnostics }),
}));
beforeEach(() => diagnostics.log.mockClear());

const stream: ReverseStreamEditor = {
  id: "test",
  label: "Test conversions",
  settings: reverseDestinationMetadata.get("google-ads")!.streams[0].settings,
  defaults: () => ({ mode: "upsert", mapping: {}, streamOptions: {} }),
  fields: options => [
    { editor: "mapping", field: "value", name: "Conversion value", required: true },
    { editor: "identifier", raw: "email", hashed: "hashedEmail", name: "Email" },
    { editor: "mapping", field: "hidden", name: "Hidden", hidden: () => true },
    { editor: "text", name: "Audience", value: options.streamOptions.secret, change: () => ({}) },
    {
      editor: "select",
      name: "Action source",
      value: options.streamOptions.actionSource,
      choices: [{ value: "website", label: "Website" }],
      change: () => ({}),
    },
  ],
};
const options = stream.defaults();
const columns = [
  { name: "customer_email", type: "25" },
  { name: "purchase_total", type: "1700" },
];
const destination = { id: "test-ads", displayName: "Test Ads" };
const config = { apiKey: "server-only-key", model: "jev-1.14.0", destination };
function provider(override?: (question: any, index: number) => any) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(init!.body as string);
    return new Response(
      JSON.stringify({
        answers: Object.fromEntries(
          Object.entries(body.questions).map(([id, q], index) => {
            const question = q as any;
            return [
              id,
              override?.(question, index) ?? {
                type: "choice",
                choice: "v0",
                confidence: 0.96,
                probabilities: Object.fromEntries(
                  Object.keys(question.criteria).map(k => [k, k === "v0" ? 0.98 : k === "none" ? 0.02 : 0])
                ),
              },
            ];
          })
        ),
      }),
      { status: 200 }
    );
  });
}

it("asks Jev about every unmapped visible field, even exact names; never sends arbitrary settings", () => {
  const { state, questions } = buildMappingQuestions(
    stream,
    {
      ...options,
      streamOptions: {
        secret: "PRIVATE-AUDIENCE",
        actionSource: "website",
        token: "PRIVATE-TOKEN",
        query: "PRIVATE-SQL",
      },
    },
    columns,
    destination
  );
  expect(state.columns.map(c => c.type)).toEqual(["text", "numeric"]);
  expect(state.selectors).toEqual([{ name: "Action source", selected: "Website" }]);
  const payload = JSON.stringify({ state, questions: questions.map(q => q.question) });
  expect(payload).not.toContain("PRIVATE");
  expect(questions.map(q => q.target.id)).toEqual(["mapping:value", "mapping:email"]);
  expect(questions[0].question.instructions.task).toMatch(/ambiguous/);
  expect(questions[1].question.instructions.task).toContain(
    "prefer raw unless the source column name or field description explicitly"
  );
  expect(questions[1].question.instructions.task).toContain("is not evidence of hashed source values");
  expect(questions[1].question.instructions.task).toContain(
    "does not resolve ambiguity between different source columns"
  );
  expect(questions[1].candidates).toEqual([
    { key: "email", format: "raw", column: "customer_email" },
    { key: "hashedEmail", format: "sha256", column: "customer_email" },
    { key: "email", format: "raw", column: "purchase_total" },
    { key: "hashedEmail", format: "sha256", column: "purchase_total" },
  ]);
});

it("does not forward a free-text value disguised as a selector", () => {
  const { state } = buildMappingQuestions(
    stream,
    { ...options, streamOptions: { actionSource: "PRIVATE" } },
    columns,
    destination
  );
  expect(state.selectors).toEqual([]);
});

it("uses the fixed endpoint, a server-only key, a deadline, and no redirects", async () => {
  const request = provider();
  const result = await suggestWithJev(stream, options, columns, config, undefined, request);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe("https://api.typesafe.ai/v1/systemone");
  expect(request.mock.calls[0][1]).toMatchObject({
    redirect: "error",
    headers: { Authorization: "Bearer server-only-key" },
    signal: expect.any(AbortSignal),
  });
  expect(result.suggestions[0].recommended?.column).toBe("customer_email");
  expect(JSON.stringify(result)).not.toContain(config.apiKey);
});

it("leaves competing candidates unresolved even with a high reported confidence", async () => {
  const request = provider(q => ({
    type: "choice",
    choice: "v0",
    confidence: 0.99,
    probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === "v0" ? 0.51 : k === "v1" ? 0.49 : 0])),
  }));
  const result = await suggestWithJev(stream, options, columns, config, undefined, request);
  expect(result.suggestions.every(s => !s.recommended && s.alternatives.length === 2)).toBe(true);
});

it.each(["none", "low"])("does not preselect %s outcomes", async kind => {
  const request = provider(q => ({
    type: "choice",
    choice: kind === "none" ? "none" : "v0",
    confidence: kind === "none" ? 1 : 0.5,
    probabilities: Object.fromEntries(
      Object.keys(q.criteria).map(k => [k, k === (kind === "none" ? "none" : "v0") ? 1 : 0])
    ),
  }));
  const result = await suggestWithJev(stream, options, columns, config, undefined, request);
  expect(result.suggestions.every(s => s.recommended === null)).toBe(true);
  expect(result.suggestions.every(s => s.noMatch === (kind === "none"))).toBe(true);
});

it.each([
  {},
  { q0: { type: "choice", choice: "invented", confidence: 1, probabilities: { invented: 1 } } },
  { q0: { type: "choice", choice: "v0", confidence: 5, probabilities: { v0: 1 } } },
])("rejects malformed or missing answers without exposing them", async answers => {
  const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ answers })));
  await expect(suggestWithJev(stream, options, columns, config, undefined, request)).rejects.toThrow(
    "Mapping suggestions are unavailable"
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it("rejects unknown candidates, invalid sums and a choice inconsistent with probabilities", async () => {
  for (const probabilities of [
    { v0: 1, v1: 1, none: 1 },
    { v0: 0, v1: 1, none: 0 },
    { v0: 1, v1: 0, evil: 0 },
  ]) {
    await expect(
      suggestWithJev(
        stream,
        options,
        columns,
        config,
        undefined,
        provider(() => ({ type: "choice", choice: "v0", confidence: 1, probabilities }))
      )
    ).rejects.toThrow("Mapping suggestions are unavailable");
  }
});

it("redacts provider failures and honors cancellation", async () => {
  await expect(
    suggestWithJev(
      stream,
      options,
      columns,
      config,
      undefined,
      vi.fn(async () => new Response("PRIVATE-SCHEMA server-only-key", { status: 401 }))
    )
  ).rejects.toThrow(/^Mapping suggestions are unavailable/);
  const logs = JSON.stringify(diagnostics.log.mock.calls);
  expect(logs).not.toContain("PRIVATE-SCHEMA");
  expect(logs).not.toContain(config.apiKey);
  expect(logs).not.toContain(columns[0].name);
  expect(diagnostics.log).toHaveBeenCalledWith(
    "Mapping suggestions failed",
    expect.objectContaining({
      category: "http",
      httpStatus: 401,
      batch: 1,
      elapsedMs: expect.any(Number),
      suggestionRequestId: expect.any(String),
    })
  );
  const failure = await suggestWithJev(
    stream,
    options,
    columns,
    config,
    undefined,
    vi.fn(async () => new Response("private", { status: 401 }))
  ).catch(error => error);
  expect(failure.message).toContain("credentials were rejected");
  expect(failure.message).toContain(failure.responseObject.requestId);
  expect(diagnostics.log).toHaveBeenLastCalledWith(
    "Mapping suggestions failed",
    expect.objectContaining({
      suggestionRequestId: failure.responseObject.requestId,
    })
  );
  const controller = new AbortController();
  controller.abort();
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    expect(init!.signal!.aborted).toBe(true);
    throw new Error("PRIVATE-SCHEMA");
  });
  await expect(suggestWithJev(stream, options, columns, config, controller.signal, request)).rejects.toThrow(
    /unavailable/
  );
  expect(request).not.toHaveBeenCalled();
});

it("rejects empty, duplicate, oversized schemas before making any external request", async () => {
  const request = provider();
  for (const invalid of [
    [],
    [columns[0], columns[0]],
    Array.from({ length: 128 }, (_, i) => ({ name: `c${i}`, type: "text" })),
    [{ name: "x".repeat(50_000), type: "text" }],
  ]) {
    await expect(suggestWithJev(stream, options, invalid, config, undefined, request)).rejects.toThrow(
      /columns|schema/
    );
  }
  expect(request).not.toHaveBeenCalled();
});

it("splits large requests without dropping candidates and discards a partial failure", async () => {
  const wideColumns = Array.from({ length: 127 }, (_, i) => ({ name: `source_${i}`, type: "text" }));
  const wideStream: ReverseStreamEditor = {
    ...stream,
    fields: () =>
      Array.from({ length: 8 }, (_, i) => ({
        editor: "identifier" as const,
        raw: `raw${i}`,
        hashed: `hash${i}`,
        name: `Identifier ${i}`,
      })),
  };
  const request = provider();
  const result = await suggestWithJev(wideStream, options, wideColumns, config, undefined, request);
  expect(result.suggestions).toHaveLength(8);
  expect(request.mock.calls.length).toBeGreaterThan(1);
  for (const [, init] of request.mock.calls) {
    expect(Buffer.byteLength(init!.body as string)).toBeLessThanOrEqual(48_000);
    const body = JSON.parse(init!.body as string);
    expect(body.state.columns).toHaveLength(127);
    for (const question of Object.values(body.questions) as any[])
      expect(Object.keys(question.criteria)).toHaveLength(255);
  }
  let calls = 0;
  const failing: typeof fetch = async (url, init) => {
    if (++calls === 2) return new Response("private details", { status: 422 });
    return request(url, init);
  };
  await expect(suggestWithJev(wideStream, options, wideColumns, config, undefined, failing)).rejects.toThrow(
    "Mapping suggestions are unavailable"
  );
  const recovering = vi.fn<typeof fetch>(async (url, init) => {
    if (recovering.mock.calls.length === 2) return new Response("", { status: 503 });
    return request(url, init);
  });
  const recovered = await suggestWithJev(wideStream, options, wideColumns, config, undefined, recovering);
  expect(recovered.suggestions).toHaveLength(8);
  const bodies = recovering.mock.calls.map(([, init]) => init!.body);
  expect(bodies[0]).not.toBe(bodies[1]);
  expect(bodies[1]).toBe(bodies[2]);
  expect(bodies.filter(body => body === bodies[0])).toHaveLength(1);
});

it("preserves existing mappings, rejects hidden/unknown keys and columns, and prevents raw/hash conflicts", () => {
  const existing = { ...options, mapping: { email: "existing" } };
  expect(mappingTargets(stream, existing).map(t => t.id)).toEqual(["mapping:value"]);
  const selections = [
    { key: "hashedEmail", column: "customer_email", probability: 1 },
    { key: "value", column: "purchase_total", probability: 1 },
    { key: "hidden", column: "customer_email", probability: 1 },
    { key: "invented", column: "customer_email", probability: 1 },
  ];
  expect(applyMappingSuggestions(stream, existing, columns, selections)).toEqual({
    mapping: { email: "existing", value: "purchase_total" },
  });
  expect(
    applyMappingSuggestions(stream, options, columns, [
      { key: "email", column: "customer_email", probability: 1 },
      { key: "hashedEmail", column: "customer_email", probability: 1 },
      { key: "value", column: "missing", probability: 1 },
    ])
  ).toEqual({ mapping: {} });
});

describe("declared object properties", () => {
  const meta = reverseDestinationMetadata.get("facebook-conversions")!;
  const conversions = meta.streams.find(s => s.id === "conversions")!;
  const appOptions = {
    ...conversions.defaults(),
    objectMappings: { appData: { advertiser_tracking_enabled: "existing_flag" }, customData: {} },
  };

  it("suggests only unmapped declared properties in composition mode, with parent context", () => {
    const { state, questions } = buildMappingQuestions(conversions, appOptions, columns, meta);
    const nested = questions.filter(q => q.target.object);
    expect(nested.map(q => q.target.object?.property)).toEqual(["application_tracking_enabled", "extinfo"]);
    const extinfo = nested.find(q => q.target.object?.property === "extinfo")!;
    expect(extinfo.question.instructions.field).toMatchObject({
      name: "App data / Extended app information",
      required: true,
      description: expect.stringContaining("all 16 extinfo positions"),
      requirement: expect.stringContaining("Required for app rows"),
      objectProperty: {
        key: "appData",
        name: "App data",
        property: "extinfo",
        description: expect.stringContaining("Object or JSON column"),
      },
    });
    expect(extinfo.question.instructions.task).toContain("not the whole parent object");
    expect(extinfo.question.instructions.task).toContain("do not construct arrays or extract nested properties");
    expect(extinfo.candidates).toEqual(columns.map(c => ({ key: "appData", property: "extinfo", column: c.name })));
    expect(questions.some(q => q.target.id === "mapping:appData" || q.target.id === "mapping:customData")).toBe(false);
    expect(JSON.stringify({ state, questions: questions.map(q => q.question) })).not.toContain("existing_flag");
  });

  it("still offers missing optional properties in an already configured object", () => {
    const google = reverseDestinationMetadata.get("google-ads")!;
    const clicks = google.streams.find(s => s.id === "click-conversions")!;
    const targets = mappingTargets(clicks, {
      ...clicks.defaults(),
      objectMappings: { sessionAttributes: { landingPageUrl: "url" } },
    }).filter(t => t.object);
    expect(targets).toHaveLength(5);
    expect(targets.some(t => t.object?.property === "landingPageUrl")).toBe(false);
    expect(targets.every(t => !t.required)).toBe(true);
  });

  it("keeps column mode and excludes nested suggestions when it is selected", () => {
    const unmapped = mappingTargets(conversions, conversions.defaults());
    expect(unmapped.some(t => t.id === "mapping:appData")).toBe(true);
    expect(unmapped.some(t => t.object)).toBe(false);
    const mapped = mappingTargets(conversions, { ...conversions.defaults(), mapping: { appData: "json" } });
    expect(mapped.some(t => t.id === "mapping:appData" || t.object)).toBe(false);
    expect(
      applyMappingSuggestions(conversions, conversions.defaults(), columns, [
        { key: "appData", property: "extinfo", column: "customer_email", probability: 1 },
      ])
    ).toEqual({ mapping: {} });
  });

  it("merges multiple properties without overwriting existing values or admitting undeclared targets", () => {
    const result = applyMappingSuggestions(conversions, appOptions, columns, [
      { key: "appData", property: "application_tracking_enabled", column: "purchase_total", probability: 1 },
      { key: "appData", property: "extinfo", column: "customer_email", probability: 1 },
      { key: "appData", property: "advertiser_tracking_enabled", column: "customer_email", probability: 1 },
      { key: "appData", property: "invented", column: "customer_email", probability: 1 },
      { key: "customData", property: "extinfo", column: "customer_email", probability: 1 },
      { key: "appData", property: "__proto__", column: "customer_email", probability: 1 },
      { key: "appData", column: "customer_email", probability: 1 },
      { key: "value", column: "purchase_total", probability: 1 },
    ]);
    expect(result).toEqual({
      mapping: { value: "purchase_total" },
      objectMappings: {
        appData: {
          advertiser_tracking_enabled: "existing_flag",
          application_tracking_enabled: "purchase_total",
          extinfo: "customer_email",
        },
        customData: {},
      },
    });
    expect(appOptions.objectMappings.appData).toEqual({ advertiser_tracking_enabled: "existing_flag" });
    expect(
      applyMappingSuggestions(conversions, appOptions, columns, [
        { key: "appData", property: "extinfo", column: "missing", probability: 1 },
        { key: "appData", property: "application_tracking_enabled", column: "customer_email", probability: 1 },
        { key: "appData", property: "application_tracking_enabled", column: "purchase_total", probability: 1 },
        { key: "value", property: "invented", column: "purchase_total", probability: 1 },
      ])
    ).toEqual({ mapping: {} });
  });

  it("preserves the property identity and uncertainty through provider responses", async () => {
    const result = await suggestWithJev(
      conversions,
      appOptions,
      columns,
      { ...config, destination: meta },
      undefined,
      provider(question => {
        if (question.instructions.field.objectProperty?.property !== "extinfo") return undefined;
        return { type: "choice", choice: "none", confidence: 0.95, probabilities: { v0: 0.02, v1: 0, none: 0.98 } };
      })
    );
    const tracking = result.suggestions.find(s => s.label === "App data / Application tracking enabled")!;
    expect(tracking.recommended).toMatchObject({ key: "appData", property: "application_tracking_enabled" });
    const extinfo = result.suggestions.find(s => s.label === "App data / Extended app information")!;
    expect(extinfo.noMatch).toBe(true);
    expect(extinfo.recommended).toBeNull();
    expect(extinfo.alternatives[0]).toMatchObject({ key: "appData", property: "extinfo" });
  });
});

describe("real destination stream coverage", () => {
  for (const [destination, metadata] of reverseDestinationMetadata) {
    for (const stream of metadata.streams) {
      it(`${destination}/${stream.id} uses only available mapping controls`, () => {
        const options = stream.defaults();
        const targets = mappingTargets(stream, options);
        if (destination === "webhook") expect(targets).toEqual([]);
        else expect(targets.length).toBeGreaterThan(0);
        expect(new Set(targets.map(t => t.id)).size).toBe(targets.length);
        const { state, questions } = buildMappingQuestions(stream, options, columns, metadata);
        const context = {
          destination: { id: metadata.id, name: metadata.displayName },
          stream: { id: stream.id, name: stream.label },
        };
        expect(state).toMatchObject(context);
        expect(questions).toHaveLength(targets.length);
        for (const q of questions) {
          expect(q.question.criteria).toHaveProperty("none");
          expect(q.question.instructions).toMatchObject(context);
          expect(q.candidates.length).toBe(columns.length * q.target.variants.length);
        }
      });
    }
  }
});

it("only includes allowlisted catalog identity even if destination context has extra properties", () => {
  const context = { ...destination, config: { secret: "PRIVATE" }, name: "PRIVATE-CUSTOMER-NAME" };
  const { state, questions } = buildMappingQuestions(stream, options, columns, context);
  expect(state.destination).toEqual({ id: "test-ads", name: "Test Ads" });
  expect(JSON.stringify({ state, questions })).not.toContain("PRIVATE");
});
