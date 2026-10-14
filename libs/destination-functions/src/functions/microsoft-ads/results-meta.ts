import { z } from "zod";
const common = { observedAt: z.string(), accountId: z.string() };
export const MicrosoftResults = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("unavailable"), message: z.string() }),
  z.object({
    ...common,
    kind: z.literal("audience"),
    targetId: z.string(),
    name: z.string(),
    searchSize: z.string().nullable(),
    audienceNetworkSize: z.string().nullable(),
  }),
  z.object({
    ...common,
    kind: z.literal("pending"),
    continuation: z.string(),
    goal: z.string(),
    start: z.string(),
    end: z.string(),
  }),
  z.object({
    ...common,
    kind: z.literal("conversions"),
    goal: z.string(),
    start: z.string(),
    end: z.string(),
    totals: z.array(z.object({ currency: z.string(), conversions: z.number().finite(), revenue: z.number().finite() })),
  }),
]);
export type MicrosoftResults = z.infer<typeof MicrosoftResults>;
