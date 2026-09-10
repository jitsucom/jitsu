// Browser-safe: types and Zod only. Do not re-export server writers from here.
import { z } from "zod";
import type {
  BatchResult,
  FinishResult,
  Json,
  ReverseEtlStreamMetadata,
  WriteBatch,
} from "@jitsu/protocols/reverse-etl";

const id = z.string().min(1).max(512);
const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValue), z.record(jsonValue)])
);
const jsonObject = z
  .record(jsonValue)
  .refine(
    value => new TextEncoder().encode(JSON.stringify(value)).length <= 65536,
    "Provider checkpoint exceeds its byte limit"
  );
const outcome = z.discriminatedUnion("status", [
  z.object({ operationId: id, status: z.literal("accepted") }).strict(),
  z.object({ operationId: id, status: z.literal("staged") }).strict(),
  z
    .object({
      operationId: id,
      status: z.literal("rejected"),
      code: z.string().min(1).max(128),
      safeReason: z.string().max(1024),
    })
    .strict(),
]);
const batchResult = z
  .object({
    outcomes: z.array(outcome).max(10000),
    remoteJobIds: z.array(id).max(100).optional(),
    providerCheckpoint: jsonObject.optional(),
  })
  .strict();
const finishResult = batchResult.omit({ outcomes: true }).extend({ delivery: z.enum(["accepted", "pending"]) });

export class ReverseEtlProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReverseEtlProtocolError";
  }
}

export function validateBatchResult<Row>(batch: WriteBatch<Row>, value: unknown): BatchResult {
  const result = batchResult.safeParse(value);
  if (!result.success) throw new ReverseEtlProtocolError("Malformed writer batch response");
  const expected = new Set(batch.records.map(record => record.operationId));
  if (expected.size !== batch.records.length) throw new ReverseEtlProtocolError("Duplicate input operation IDs");
  const seen = new Set<string>();
  for (const record of result.data.outcomes) {
    if (!expected.has(record.operationId) || seen.has(record.operationId))
      throw new ReverseEtlProtocolError("Foreign or duplicate outcome operation ID");
    seen.add(record.operationId);
  }
  if (seen.size !== expected.size) throw new ReverseEtlProtocolError("Writer omitted operation outcomes");
  return result.data as BatchResult;
}

export function validateFinishResult(value: unknown): FinishResult {
  const result = finishResult.safeParse(value);
  if (!result.success) throw new ReverseEtlProtocolError("Malformed writer finish response");
  if (result.data.delivery === "pending" && !result.data.remoteJobIds?.length) {
    throw new ReverseEtlProtocolError("Pending finish requires recoverable remote job IDs");
  }
  return result.data as FinishResult;
}

export function validateStream(stream: ReverseEtlStreamMetadata<any, any>) {
  if (!stream.name || !Number.isSafeInteger(stream.batchSize) || stream.batchSize < 1 || stream.batchSize > 10000) {
    throw new ReverseEtlProtocolError("Stream requires a name and batch size between 1 and 10000");
  }
  if (stream.capabilities.supportsExplicitRemove && !stream.removeRowType) {
    throw new ReverseEtlProtocolError("Explicit remove requires a removal schema");
  }
}

export function validateReverseEtlConfig<Row, Options>(
  stream: ReverseEtlStreamMetadata<Row, Options>,
  input: {
    mode: "upsert" | "mirror";
    cursor?: unknown;
    deleteColumn?: string;
    mapping: Record<string, string>;
    columns: string[];
    options: unknown;
  }
): Options {
  validateStream(stream);
  if (!stream.capabilities.supportsUpsert) throw new ReverseEtlProtocolError("Stream does not support upserts");
  if (input.mode === "mirror" && (input.cursor || stream.capabilities.mirror === "none"))
    throw new ReverseEtlProtocolError("Mirror requires a full model and mirror-capable stream");
  if (input.deleteColumn && !stream.capabilities.supportsExplicitRemove)
    throw new ReverseEtlProtocolError("Delete-column models require explicit remove support");
  if (
    !Object.keys(input.mapping).length ||
    Object.values(input.mapping).some(column => !input.columns.includes(column))
  ) {
    throw new ReverseEtlProtocolError("Mappings must reference projected model columns");
  }
  let schema: z.ZodTypeAny = stream.rowType;
  while (schema instanceof z.ZodEffects) schema = schema.innerType();
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    if (
      Object.keys(input.mapping).some(field => !Object.hasOwn(shape, field)) ||
      Object.entries(shape).some(
        ([field, value]) => !(value as z.ZodTypeAny).isOptional() && !Object.hasOwn(input.mapping, field)
      )
    ) {
      throw new ReverseEtlProtocolError("Mapping must include required stream fields and no unknown fields");
    }
  }
  const options = stream.options.safeParse(input.options);
  if (!options.success) throw new ReverseEtlProtocolError("Invalid reverse stream options");
  return options.data;
}
