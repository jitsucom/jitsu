import { z } from "zod";
import { ModelDefinition, ReverseSyncOptions, validateReverseSyncModel } from "./schema";

/** Versioned console -> syncctl Secret -> Node contract. Credentials stay in Secrets. */
export const ReverseRunConfig = z
  .object({
    version: z.literal(1),
    kind: z.literal("reverse"),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
    workspaceId: z.string().min(1).max(128),
    fromId: z.string().min(1),
    toId: z.string().min(1),
    configRevision: z.string().regex(/^[a-f0-9]{64}$/),
    updatedAt: z.string().datetime(),
    schedule: z.string().optional(),
    timezone: z.string().default("Etc/UTC"),
    model: ModelDefinition,
    warehouse: z.record(z.unknown()),
    destination: z.record(z.unknown()),
    options: ReverseSyncOptions,
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      validateReverseSyncModel(value.model, value.options);
      if (value.options.mode === "mirror" && value.model.deleteColumn)
        throw new Error("Mirror uses full membership, not tombstones");
      // Paused configs may resume saved delivery; admission must prohibit new extraction.
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid reverse run configuration" });
    }
  });
export type ReverseRunConfig = z.infer<typeof ReverseRunConfig>;
