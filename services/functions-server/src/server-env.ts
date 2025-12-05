import { z } from "zod";

const ServerEnvSchema = z.object({
  // HTTP Server Configuration
  PORT: z.string().optional().default("3456"),

  // Config directory (required)
  CONFIG_DIR: z.string().default("./data"),

  // Initialize filesystem from repositories on startup
  // When true, fetches configs from repository and saves to CONFIG_DIR
  INIT_FILES: z
    .string()
    .optional()
    .transform(v => v === "true" || v === "1"),

  // Repository Configuration (required when INIT_FILES=true)
  REPOSITORY_BASE_URL: z.string().optional(),
  REPOSITORY_AUTH_TOKEN: z.string().optional(),
  REPOSITORY_REFRESH_PERIOD_SEC: z.string().optional().default("2"),

  // Logging
  LOG_FORMAT: z.string().optional().default("text"),
  NODE_ENV: z.string().optional().default("development"),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = ServerEnvSchema.safeParse(process.env);

  if (!result.success) {
    const errors: string[] = [];

    for (const issue of result.error.issues) {
      const field = issue.path.join(".");

      if (issue.code === "invalid_type") {
        if (issue.received === "undefined") {
          errors.push(`${field} - missing`);
        } else {
          errors.push(`${field} - expected ${issue.expected}, received ${issue.received}`);
        }
      } else {
        errors.push(`${field} - invalid format: ${issue.code} ${issue.message}`);
      }
    }

    throw new Error(`Following env vars are misconfigured:\n${errors.join("\n")}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}
