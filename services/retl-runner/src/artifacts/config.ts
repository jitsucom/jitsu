import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";
import { gcsObjects, s3Objects } from "./cloud";

const Config = z.object({
  RETL_OBJECT_STORE: z.enum(["gcs", "s3"]).optional(),
  RETL_OBJECT_BUCKET: z
    .string()
    .min(3)
    .max(222)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]+$/)
    .optional(),
  RETL_OBJECT_PREFIX: z
    .string()
    .regex(/^[a-zA-Z0-9/_-]*$/)
    .default("reverse-etl/"),
  RETL_S3_ENDPOINT: z.string().url().optional(),
  RETL_S3_REGION: z.string().default("us-east-1"),
});
function storeFor(config: z.infer<typeof Config>, bucket: string) {
  const prefix = config.RETL_OBJECT_PREFIX.replace(/\/?$/, "/");
  return config.RETL_OBJECT_STORE === "gcs"
    ? gcsObjects(bucket, prefix)
    : s3Objects(
        bucket,
        prefix,
        new S3Client({
          region: config.RETL_S3_REGION,
          endpoint: config.RETL_S3_ENDPOINT,
          forcePathStyle: !!config.RETL_S3_ENDPOINT,
        })
      );
}
export function objectStorageFromEnv(input: Record<string, string | undefined>, signal: AbortSignal) {
  const config = Config.parse(input);
  if (!config.RETL_OBJECT_STORE) throw new Error("RETL_OBJECT_STORE is required (gcs or s3)");
  if (!config.RETL_OBJECT_BUCKET) throw new Error("RETL_OBJECT_BUCKET is required");
  return { signal, store: storeFor(config, config.RETL_OBJECT_BUCKET) };
}
/** The per-workspace retention bucket named by the run configuration: same provider, credentials and prefix as the main store. */
export function retentionStoreFromEnv(input: Record<string, string | undefined>, bucket: string) {
  const config = Config.parse(input);
  if (!config.RETL_OBJECT_STORE) throw new Error("RETL_OBJECT_STORE is required (gcs or s3)");
  return storeFor(config, bucket);
}
