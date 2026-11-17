export type AuthRateLimitError = "rate_limit_exceeded" | "rate_limiter_unavailable";

export function authRateLimitMessage(error: unknown): string | undefined {
  if (error === "rate_limit_exceeded") return "Too many authentication attempts. Please wait and try again.";
  if (error === "rate_limiter_unavailable") return "Sign-in is temporarily unavailable. Please try again shortly.";
}
