// Pure constants/helpers for the admin service-account identity. Kept in
// `lib/shared` (no Prisma / Next / server imports) so it can be pulled into
// light modules — e.g. the rate-limiter — without dragging in the full
// server module graph that `lib/api.ts` brings.

export const adminServiceAccountEmail = "admin-service-account@jitsu.com";

export function isAdminServiceAccount(user: {
  internalId?: string | null;
  loginProvider?: string | null;
}): boolean {
  return user.internalId === adminServiceAccountEmail && user.loginProvider === "admin/token";
}
