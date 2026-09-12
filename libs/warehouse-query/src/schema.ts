import { z } from "zod";

const column = z
  .string()
  .min(1)
  .max(256)
  .refine(s => !s.includes("\0"), "Invalid column name");
export const ModelDefinition = z.object({
  warehouseId: z.string().min(1),
  query: z.string().trim().min(1).max(100_000),
  primaryKey: z
    .array(column)
    .min(1)
    .max(8)
    .refine(a => new Set(a).size === a.length, "Duplicate primary-key column"),
  cursor: z
    .object({
      column,
      type: z.enum(["timestamp", "number", "string"]),
      lookbackSeconds: z.number().int().min(0).max(604800).optional(),
    })
    .refine(c => c.lookbackSeconds === undefined || c.type === "timestamp", "Lookback requires a timestamp cursor")
    .optional(),
  deleteColumn: column.optional(),
  pageSize: z.number().int().min(1).max(10_000).default(1_000),
  description: z.string().max(10_000).optional(),
});
export type ModelDefinition = z.infer<typeof ModelDefinition>;

export const ReverseSyncOptions = z
  .object({
    version: z.literal(2).default(2),
    stream: z.string().min(1),
    mode: z.enum(["upsert", "mirror"]),
    mapping: z.record(z.string().min(1)),
    streamOptions: z.record(z.unknown()).default({}),
    schedule: z.string().optional(),
    timezone: z.string().optional(),
    checkpointEvery: z.number().int().min(1).max(1_000_000).default(50_000),
    errorPolicy: z.literal("fail").default("fail"),
    disabled: z.boolean().default(false),
  })
  .strict();
export type ReverseSyncOptions = z.infer<typeof ReverseSyncOptions>;

export function validateReverseSyncModel(model: ModelDefinition, options: ReverseSyncOptions) {
  if (options.mode === "mirror" && model.cursor)
    throw new Error("Mirror requires a model without an incremental cursor");
}

export const PreviewRequest = ModelDefinition.pick({ warehouseId: true, query: true });
export const WarehouseColumn = z.object({
  name: z.string(),
  type: z.string(),
  // Advisory preview metadata for the picker; save-time validation is authoritative.
  supportsDelete: z.boolean().optional(),
});
export type WarehouseColumn = z.infer<typeof WarehouseColumn>;
export const PreviewResult = z.object({
  columns: z.array(WarehouseColumn),
  rows: z.array(z.record(z.unknown())),
  truncated: z.boolean(),
});
export type PreviewResult = z.infer<typeof PreviewResult>;

// Only connections supported by this first reader release appear in the picker.
export function supportsWarehouseReader(config: Record<string, any>): boolean {
  if (config.provisioned) return false;
  return (
    (config.destinationType === "postgres" &&
      (!config.authenticationMethod || config.authenticationMethod === "password")) ||
    (config.destinationType === "clickhouse" && ["http", "https"].includes(config.protocol))
  );
}
