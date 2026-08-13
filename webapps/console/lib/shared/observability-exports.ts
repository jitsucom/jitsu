import { z } from "zod";
import { Simplify } from "type-fest";
import { MASKED_SECRET } from "../schema/destinations";

export const observabilityExportsNamespace = "observability-exports";

export const ObservabilityExportHeader = z.object({
  name: z.string().trim().min(1),
  value: z.string(),
});

export type ObservabilityExportHeader = Simplify<z.infer<typeof ObservabilityExportHeader>>;

export const ObservabilityExportsSettings = z
  .object({
    enabled: z.boolean().default(false),
    endpoint: z.string().trim().default(""),
    headers: z.array(ObservabilityExportHeader).default([]),
  })
  .superRefine((val, ctx) => {
    // endpoint may stay empty while the export is off — the switch can be
    // flipped off without clearing the form
    if (!val.enabled && !val.endpoint) {
      return;
    }
    let url: URL;
    try {
      url = new URL(val.endpoint);
    } catch (e) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endpoint"], message: "Invalid URL" });
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endpoint"],
        message: "Endpoint must be an http(s) URL",
      });
    }
  })
  .superRefine((val, ctx) => {
    // HTTP header names are case-insensitive; duplicates would both collide at
    // request time (last one wins) and make name-keyed unmasking ambiguous
    const seen = new Set<string>();
    val.headers.forEach((h, i) => {
      const name = h.name.toLowerCase();
      if (seen.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["headers", i, "name"],
          message: `Duplicate header name: ${h.name}`,
        });
      }
      seen.add(name);
    });
  });

export type ObservabilityExportsSettings = Simplify<z.infer<typeof ObservabilityExportsSettings>>;

export const defaultObservabilityExportsSettings: ObservabilityExportsSettings = {
  enabled: false,
  endpoint: "",
  headers: [],
};

/**
 * Header values are write-only credentials: GET returns them masked, PUT accepts the mask back
 * as "keep the stored value" (matched by header name)
 */
export function maskObservabilityExportsSettings(settings: ObservabilityExportsSettings): ObservabilityExportsSettings {
  return {
    ...settings,
    headers: settings.headers.map(h => ({ name: h.name, value: h.value ? MASKED_SECRET : "" })),
  };
}

export function unmaskObservabilityExportsSettings(
  settings: ObservabilityExportsSettings,
  stored: ObservabilityExportsSettings | undefined
): ObservabilityExportsSettings {
  const storedByName = new Map((stored?.headers || []).map(h => [h.name, h.value]));
  return {
    ...settings,
    headers: settings.headers.map(h =>
      h.value === MASKED_SECRET ? { name: h.name, value: storedByName.get(h.name) ?? "" } : h
    ),
  };
}

export function containsMaskedHeaderValues(settings: ObservabilityExportsSettings): boolean {
  return settings.headers.some(h => h.value === MASKED_SECRET);
}
