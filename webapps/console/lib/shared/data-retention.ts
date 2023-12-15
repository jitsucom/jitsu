import { z } from "zod";
import { Simplify } from "type-fest";

export const DataRetentionSettings = z.object({
  kafkaRetentionHours: z.coerce.number(),
  identityStitchingRetentionDays: z.coerce.number(),
  logsRetentionDays: z.object({
    maxRecords: z.coerce.number(),
    maxHours: z.coerce.number(),
  }),
  customMongoDb: z.string().optional(),
  disableS3Archive: z.coerce.boolean().default(false).optional(),
  pendingUpdate: z.coerce.boolean().default(false).optional(),
});

// Example of type derived from Zod schema
export type DataRetentionSettings = Simplify<z.infer<typeof DataRetentionSettings>>;

export const defaultDataRetentionSettings: DataRetentionSettings = {
  kafkaRetentionHours: 7 * 24,
  identityStitchingRetentionDays: 30,
  logsRetentionDays: {
    maxRecords: 1000,
    maxHours: 7 * 24,
  },
};
