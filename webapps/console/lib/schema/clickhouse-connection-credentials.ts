import { z } from "zod";

export const ClickhouseConnectionCredentials = z.object({
  host: z.string(),
  username: z.string(),
  database: z.string(),
  password: z.string(),
  httpPort: z.number(),
  pgPort: z.number(),
  tcpPort: z.number(),
});
export type ClickhouseConnectionCredentials = z.infer<typeof ClickhouseConnectionCredentials>;
