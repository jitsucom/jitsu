import { expect, it } from "vitest";
import { googleConversionEditor } from "../src/functions/google-ads/conversions/editor";

it.each([
  ["click-conversions", "data-manager"],
  ["click-conversions", "google-ads"],
  ["call-conversions", undefined],
  ["conversion-adjustments", undefined],
] as const)("omits the authorization hint from %s (%s) without removing conversion settings", (stream, api) => {
  const editor = googleConversionEditor(stream);
  const options = editor.defaults();
  const fields = editor.fields({ ...options, streamOptions: { ...options.streamOptions, ...(api ? { api } : {}) } });
  expect(fields.some(field => field.editor === "notice" && field.title === "Google Ads API authorization")).toBe(false);
  expect(fields.some(field => field.editor === "notice" && field.key === "event-mode")).toBe(true);
  expect(fields.some(field => field.editor === "target" && field.targetKind === "conversion-action")).toBe(true);
});
