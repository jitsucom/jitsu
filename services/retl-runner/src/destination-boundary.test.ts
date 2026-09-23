import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { z } from "zod";
import { reverseDestinationMetadata } from "@jitsu/destination-functions/src/reverse-etl/catalog";
import { GoogleAudienceRow } from "@jitsu/destination-functions/src/functions/google-ads/audience/meta";
import { googleConversionRows } from "@jitsu/destination-functions/src/functions/google-ads/conversions/meta";
import type { ReverseEditorOptions } from "@jitsu/protocols/reverse-etl-editor";

describe("destination package boundaries", () => {
  it("bundles metadata for browsers without runtime, credentials services or React", async () => {
    const result = await build({
      entryPoints: ["../../libs/destination-functions/src/reverse-etl/catalog.ts"],
      bundle: true,
      platform: "browser",
      write: false,
      metafile: true,
    });
    const imports = Object.keys(result.metafile!.inputs).join("\n");
    expect(imports).not.toMatch(
      /(?:prisma|nango|node:|react\/|audience\/runtime|conversions\/runtime|provisioning|clients\/)/
    );
  });

  it("bundles provider runtime without console, runner, database or OAuth-host dependencies", async () => {
    const result = await build({
      entryPoints: ["../../libs/destination-functions/src/reverse-etl/runtime.ts"],
      bundle: true,
      platform: "node",
      write: false,
      metafile: true,
    });
    const imports = Object.keys(result.metafile!.inputs).join("\n");
    expect(imports).not.toMatch(/(?:webapps\/|services\/|prisma|nango|node_modules\/pg\/|warehouse-query)/);
  });

  it("preserves audience defaults and maps only schema-backed fields across all streams", () => {
    const streams = reverseDestinationMetadata.get("google-ads")!.streams;
    expect(streams.map(s => s.id)).toEqual([
      "audience",
      "click-conversions",
      "call-conversions",
      "conversion-adjustments",
    ]);
    expect(streams[0].defaults()).toEqual({
      mode: "mirror",
      mapping: {},
      streamOptions: {
        audience: { kind: "managed", displayName: "" },
        mirrorStrategy: "snapshot-diff",
        customerMatchTermsAccepted: false,
        exclusiveManagementConfirmed: false,
      },
    });
    for (const stream of streams) {
      const schema =
        stream.id === "audience"
          ? GoogleAudienceRow
          : googleConversionRows[stream.id as keyof typeof googleConversionRows];
      for (const identifierType of ["CONTACT_INFO", "CRM_ID", "MOBILE_ADVERTISING_ID"]) {
        const options = stream.defaults();
        options.streamOptions.identifierType = identifierType;
        for (const field of stream.fields(options)) {
          const keys =
            field.editor === "identifier" ? [field.raw, field.hashed] : field.editor === "mapping" ? [field.field] : [];
          const shape = (schema instanceof z.ZodEffects ? schema.innerType() : schema).shape;
          for (const key of keys) expect(key in shape, stream.id + "." + key).toBe(true);
          expect(field.name || field.key).toBeTruthy();
        }
      }
    }
  });

  it("does not rewrite legacy settings while describing the form", () => {
    const stream = reverseDestinationMetadata.get("google-ads")!.streams[0];
    const options: ReverseEditorOptions = {
      mode: "mirror",
      mapping: { hashedEmail: "hash" },
      streamOptions: {
        audienceId: "123",
        managedAudienceId: "retl-google-" + "a".repeat(64),
        customerMatchTermsAccepted: true,
      },
    };
    const original = JSON.stringify(options);
    const fields = stream.fields(options);
    expect(JSON.stringify(options)).toBe(original);
    const consent = fields.find(f => f.name === "Exclusive management")!;
    expect(consent.editor === "checkbox" && consent.value).toBe(true);
    const type = fields.find(f => f.name === "Identifier type")!;
    if (type.editor !== "select") throw new Error("Missing identifier selector");
    expect(type.change("CRM_ID")).toEqual({
      mapping: {},
      streamOptions: { ...options.streamOptions, identifierType: "CRM_ID" },
    });
  });
});
