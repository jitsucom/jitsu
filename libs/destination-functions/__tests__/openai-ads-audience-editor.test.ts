import { describe, expect, it } from "vitest";
import { openAiAudienceEditor } from "../src/functions/openai-ads/editor";
import { resolveStreamEditor, streamRequirementErrors } from "../src/reverse-etl/editor";
import { validateOpenAiAdsReverseSettings } from "../src/functions/openai-ads/reverse-meta";

const managed = (mapping: Record<string, string> = {}, patch: Record<string, unknown> = {}) => ({
  ...openAiAudienceEditor.defaults(),
  mapping,
  streamOptions: {
    audience: { kind: "managed", name: "My audience" },
    exclusiveManagementConfirmed: true,
    ...patch,
  },
});
const existing = (mapping: Record<string, string> = {}, audienceId = "caud_0123456789abcdef0123456789abcdef") =>
  ({ mode: "upsert", mapping, streamOptions: { audience: { kind: "existing", audienceId } } } as any);

describe("OpenAI Ads audience editor", () => {
  it("starts as a managed mirror and lists what is missing", () => {
    const defaults = openAiAudienceEditor.defaults();
    expect(defaults).toMatchObject({ mode: "mirror", streamOptions: { audience: { kind: "managed", name: "" } } });
    expect(streamRequirementErrors(openAiAudienceEditor, defaults)).toEqual([
      "Audience name is required.",
      "Exclusive management is required.",
      "Member identifier: configure at least one complete option.",
    ]);
  });
  it("accepts any one identifier, raw or pre-hashed, as a complete mapping", () => {
    for (const mapping of [{ email: "e" }, { hashedEmail: "e" }, { phone: "p" }, { hashedPhone: "p" }, { gaid: "g" }])
      expect(streamRequirementErrors(openAiAudienceEditor, managed(mapping))).toEqual([]);
    expect(streamRequirementErrors(openAiAudienceEditor, managed({}))).toEqual([
      "Member identifier: configure at least one complete option.",
    ]);
  });
  it("needs a name and the exclusive-management confirmation for a managed audience", () => {
    expect(
      streamRequirementErrors(openAiAudienceEditor, managed({ email: "e" }, { exclusiveManagementConfirmed: false }))
    ).toEqual(["Exclusive management is required."]);
    expect(
      streamRequirementErrors(
        openAiAudienceEditor,
        managed({ email: "e" }, { audience: { kind: "managed", name: "" } })
      )
    ).toEqual(["Audience name is required."]);
  });
  it("switches to an existing audience: add and remove mode, an audience ID, no exclusive-management field", () => {
    const fields = openAiAudienceEditor.fields(managed({ email: "e" }));
    const select = fields.find(f => f.editor === "select") as any;
    const patch = select.change("existing");
    expect(patch.mode).toBe("upsert");
    expect(patch.streamOptions.audience).toEqual({ kind: "existing", audienceId: "" });
    expect(patch.streamOptions.exclusiveManagementConfirmed).toBe(false);
    expect(streamRequirementErrors(openAiAudienceEditor, existing({ email: "e" }, ""))).toEqual([
      "Audience ID is required.",
    ]);
    expect(streamRequirementErrors(openAiAudienceEditor, existing({ hashedPhone: "p" }))).toEqual([]);
    expect(resolveStreamEditor(openAiAudienceEditor, existing({ email: "e" })).required.map(f => f.name)).toEqual([
      "Audience",
      "Audience ID",
    ]);
    // And back: a managed audience brings its mode and checkbox back.
    const back = (openAiAudienceEditor.fields(existing({ email: "e" })).find(f => f.editor === "select") as any).change(
      "managed"
    );
    expect(back.mode).toBe("mirror");
  });
  it("explains eligibility in the Audience help and shows exactly one leading notice: the mirror warning", () => {
    const fields = openAiAudienceEditor.fields(managed({ email: "e" })) as any[];
    expect(fields.find(f => f.editor === "select").documentation).toContain("25,000");
    expect(fields.find(f => f.editor === "select").documentation).toContain("EEA");
    const notices = fields.filter(f => f.editor === "notice");
    // The console renders every notice before the requirement cards and expects one at most.
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toContain("Changing a member's email can remove them");
    expect(openAiAudienceEditor.fields(existing({ email: "e" })).filter(f => f.editor === "notice")).toHaveLength(0);
  });
  it("offers raw or SHA-256 for email and phone and a raw-only GAID", () => {
    const fields = openAiAudienceEditor.fields(managed({ email: "e" })) as any[];
    expect(fields.filter(f => f.editor === "identifier").map(f => [f.raw, f.hashed])).toEqual([
      ["email", "hashedEmail"],
      ["phone", "hashedPhone"],
    ]);
    const gaid = fields.find(f => f.editor === "mapping" && f.field === "gaid");
    expect(gaid.documentation).toContain("Do not hash");
  });
  it("produces configurations the save-time validation accepts, and refuses what the editor cannot catch", () => {
    const destination = { adsApiKey: "ads-key" };
    const save = (o: any) =>
      validateOpenAiAdsReverseSettings(
        { stream: "audience", mode: o.mode, streamOptions: o.streamOptions, mapping: o.mapping },
        {},
        destination
      );
    expect(() => save(managed({ email: "e" }))).not.toThrow();
    expect(() => save(existing({ hashedPhone: "p" }))).not.toThrow();
    expect(() => save(managed({}))).toThrow("Map at least one member identifier");
    expect(() => save(managed({ email: "e", hashedEmail: "h" }))).toThrow("raw or SHA-256");
    expect(() => save(managed({ email: "e", bogus: "x" }))).toThrow("Unknown OpenAI audience mapping field");
    expect(() => save(managed({ email: "e" }, { exclusiveManagementConfirmed: false }))).toThrow(
      "exclusive management"
    );
    expect(() => save({ ...managed({ email: "e" }), mode: "upsert" })).toThrow("require mirror mode");
    expect(() => save({ ...existing({ email: "e" }), mode: "mirror" })).toThrow("managed audience");
    expect(() => save(existing({ email: "e" }, "not-an-id"))).toThrow(
      "managed audience name or an existing audience ID"
    );
    expect(() =>
      validateOpenAiAdsReverseSettings(
        { stream: "audience", mode: "mirror", streamOptions: managed().streamOptions },
        { deleteColumn: "d" },
        destination
      )
    ).toThrow("without a cursor or delete column");
    expect(() =>
      validateOpenAiAdsReverseSettings(
        { stream: "audience", mode: "mirror", streamOptions: managed().streamOptions },
        {},
        { conversionsApiKey: "k" }
      )
    ).toThrow("Ads API key");
  });
});
