import { getCoreDestinationTypeNonStrict } from "../schema/destinations";
import { ApiError } from "../shared/errors";

function missingMetaEventPixel(config: any): boolean {
  return (
    config?.destinationType === "facebook-conversions" && (typeof config.pixelId !== "string" || !config.pixelId.trim())
  );
}

const metaEventPixelError = () =>
  new ApiError("Meta event connections require a Pixel / Dataset ID on the destination", { status: 400 });

export function eventDestinationError(config: any): ApiError | undefined {
  if (getCoreDestinationTypeNonStrict(config?.destinationType)?.reverseEtlOnly)
    return new ApiError("This destination supports Reverse ETL only, not event connections", { status: 400 });
  if (missingMetaEventPixel(config)) return metaEventPixelError();
  if (
    config?.destinationType === "google-ads" &&
    !config.conversionActionId?.trim() &&
    !config.conversionActions?.some((value: unknown) => {
      if (typeof value !== "string") return false;
      const equals = value.indexOf("=");
      return equals > 0 && !!value.slice(0, equals).trim() && /^\d+$/.test(value.slice(equals + 1).trim());
    })
  )
    return new ApiError(
      "Google Ads event connections require a default Conversion Action ID or per-event conversion actions",
      { status: 400 }
    );
}

export function ingestionDestinationError(config: any): ApiError | undefined {
  if (config?.destinationType === "redshift" && !config.bucket?.trim())
    return new ApiError(
      "Redshift ingestion connections and ordinary syncs require an S3 staging bucket. A source-only Reverse ETL warehouse does not.",
      { status: 400 }
    );
}
