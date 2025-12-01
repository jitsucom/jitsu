import { SafeParseError, z } from "zod";

/**
 * Client-side environment variables schema.
 * These variables are exposed to the browser and should NOT contain any secrets.
 * All client-side variables must be prefixed with NEXT_PUBLIC_
 */
export const ClientEnvSchema = z.object({
  // Telemetry debug mode - enables verbose logging of telemetry events on client side
  NEXT_PUBLIC_TELEMETRY_DEBUG: z.string().optional(),

  // Client-side log level - controls verbosity of browser console logs
  // Values: "debug", "info", "warn", "error"
  NEXT_PUBLIC_LOG_LEVEL: z.string().optional().default("info"),

  // Node environment - automatically inlined by Next.js at build time
  NODE_ENV: z.enum(["development", "production", "test"]).optional().default("production"),
});

export type ClientEnv = z.infer<typeof ClientEnvSchema>;

export function isBuilding() {
  return process.env.NEXT_PHASE && process.env.NEXT_PHASE.includes("build");
}

export function wrapZodError(result: SafeParseError<any>) {
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

  return new Error(`Following env vars are misconfigured:\n${errors.join("\n")}`);
}

/**
 * Gets validated client environment variables.
 * Safe to use in browser code.
 */
export function getClientEnv(): ClientEnv {
  if (isBuilding()) {
    //if building, return bogus impl
    return {} as ClientEnv;
  }

  // IMPORTANT: Must explicitly access each var for Next.js to inline them at build time.
  // Next.js only replaces NEXT_PUBLIC_* vars when accessed directly like process.env.NEXT_PUBLIC_FOO.
  // Passing process.env object to Zod won't work because Next.js can't statically analyze it,
  // and process.env doesn't exist in the browser at runtime.
  const env = {
    NEXT_PUBLIC_TELEMETRY_DEBUG: process.env.NEXT_PUBLIC_TELEMETRY_DEBUG,
    NEXT_PUBLIC_LOG_LEVEL: process.env.NEXT_PUBLIC_LOG_LEVEL,
    //yes, this is not mistake, it's available despite not having NEXT_PUBLIC_ prefix
    NODE_ENV: process.env.NODE_ENV,
  };

  const result = ClientEnvSchema.safeParse(env);

  if (!result.success) {
    throw wrapZodError(result);
  }

  return result.data;
}
