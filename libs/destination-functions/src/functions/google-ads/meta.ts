// Browser entry point. Never export API clients, runtime factories or provisioning here.
import { googleAudienceEditor } from "./audience/editor";
import { googleConversionEditor } from "./conversions/editor";
import { googleConversionStreams, GoogleConversionStream, GoogleConversionOptions } from "./conversions/meta";
import { GoogleAudienceSettings } from "./audience/meta";
export * from "./credentials";
export * from "./audience/meta";
export * from "./conversions/meta";
export const googleAdsMetadata = {
  id: "google-ads",
  displayName: "Google Ads",
  streams: [googleAudienceEditor, ...googleConversionStreams.map(googleConversionEditor)],
};

/** Validate provider rules without warehouse queries, tokens, target creation or React. */
export function validateGoogleReverseSettings(
  options: { stream: string; mode: "upsert" | "mirror"; streamOptions: unknown },
  model: { cursor?: unknown; deleteColumn?: unknown }
) {
  if (options.stream !== "audience") {
    GoogleConversionStream.parse(options.stream);
    GoogleConversionOptions.parse(options.streamOptions);
    if (options.mode !== "upsert" || model.deleteColumn)
      throw new Error("Conversion streams require insert mode and a model without a delete column");
    return;
  }
  const settings = GoogleAudienceSettings.parse(options.streamOptions);
  if (options.mode === "mirror" && (model.cursor || model.deleteColumn))
    throw new Error("Mirror requires a full-query model without a cursor or delete column");
  if (settings.audience.kind === "managed" && options.mode !== "mirror")
    throw new Error("Managed audiences require mirror mode");
  if (settings.mirrorStrategy === "full-replace" && options.mode !== "mirror")
    throw new Error("Full replacement requires mirror mode");
  if (options.mode === "mirror" && settings.audience.kind === "existing" && settings.mirrorStrategy !== "full-replace")
    throw new Error("Existing audiences require full replacement for mirror mode");
}
