import { z } from "zod";
import { Simplify } from "type-fest";

export const DomainCheckResponse = z.union([
  z.object({
    ok: z.literal(true),
    reason: z.never().optional(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.union([z.literal("used_by_other_workspace"), z.literal("invalid_domain_name")]),
    cnameValue: z.never().optional(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.literal("requires_cname_configuration"),
    cnameValue: z.string().optional(),
  }),
]);

export type DomainCheckResponse = Simplify<z.infer<typeof DomainCheckResponse>>;
