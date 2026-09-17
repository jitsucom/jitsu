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
export function objectStorageFromEnv(input: Record<string, string | undefined>, signal: AbortSignal) {
  const config = Config.parse(input);
  if (!config.RETL_OBJECT_STORE) {
    if (config.RETL_OBJECT_BUCKET) throw new Error("RETL_OBJECT_STORE is required when configuring a bucket");
    return undefined;
  }
  if (!config.RETL_OBJECT_BUCKET) throw new Error("RETL_OBJECT_BUCKET is required");
  const prefix = config.RETL_OBJECT_PREFIX.replace(/\/?$/, "/");
  return {
    signal,
    store:
      config.RETL_OBJECT_STORE === "gcs"
        ? gcsObjects(config.RETL_OBJECT_BUCKET, prefix)
        : s3Objects(
            config.RETL_OBJECT_BUCKET,
            prefix,
            new S3Client({
              region: config.RETL_S3_REGION,
              endpoint: config.RETL_S3_ENDPOINT,
              forcePathStyle: !!config.RETL_S3_ENDPOINT,
            })
          ),
  };
}
