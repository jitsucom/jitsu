import { NextApiRequest, NextApiResponse } from "next";
import { assertDefined, checkRawToken, createAuthorized, getErrorMessage, requireDefined } from "juava";

import { getServerLog } from "./log";
import { getFirebaseToken, verifyFirebaseToken } from "./firebase-auth";
import { isAdminEmail } from "./admins";
import { prisma } from "./db";

const log = getServerLog("auth");

/**
 * Trusted system callers authenticate with a static bearer token. Either grants
 * admin:
 *  - `EE_API_SERVICE_TOKENS` — a comma-separated allow-list. Console sends one
 *    of these for its server-to-server calls (the scheduled-sync quota check,
 *    the bulker connections export) — calls that have no signed-in user.
 *  - `CRON_SECRET` — kept only for Vercel-managed cron jobs. Vercel injects an
 *    `Authorization: Bearer $CRON_SECRET` header and the env var must be named
 *    exactly that, so it can't be folded into the list above.
 */
const serviceTokenAuthorizer = createAuthorized(process.env.EE_API_SERVICE_TOKENS || "", checkRawToken);

function isSystemToken(bearer: string): boolean {
  return serviceTokenAuthorizer(bearer) || (!!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET);
}

/**
 * Result of authenticating a request.
 *
 * `admin` callers may act on any workspace; `user` callers may act only on
 * workspaces they belong to — enforced per-request via `requireWorkspaceAccess`.
 * Admin status is decided here, by ee-api, from the `JITSU_EE_ADMINS` allow-list
 * (see lib/admins.ts) — console never asserts it.
 */
export type AuthClaims = {
  type: "user" | "admin";
  /** Caller's email. A synthetic address for cron / dev callers. */
  email: string;
  /** Internal Jitsu user id (newjitsu."UserProfile".id). Absent for non-user callers. */
  userId?: string;
};

/** The `Authorization: Bearer <token>` value, if present. */
function getBearerToken(req: NextApiRequest): string | undefined {
  const authVal = req.headers.authorization;
  const prefix = "bearer ";
  if (authVal && authVal.toLowerCase().startsWith(prefix)) {
    return authVal.substring(prefix.length);
  }
  return undefined;
}

/**
 * Authenticate an incoming request.
 *
 * Order of resolution:
 *  1. A static system token in an `Authorization: Bearer` header —
 *     `EE_API_SERVICE_TOKENS` (console's server-to-server calls) or
 *     `CRON_SECRET` (Vercel crons). Granted admin.
 *  2. A Firebase token (via `x-fb-auth` header or `fb-auth2` cookie — see
 *     `firebase-auth.ts::getFirebaseToken`). Admin status is derived from
 *     `JITSU_EE_ADMINS`.
 *
 * Writes a 401 and returns `undefined` when no valid credential is present.
 */
export async function auth(req: NextApiRequest, res: NextApiResponse): Promise<AuthClaims | undefined> {
  // 1. System caller — a static service token.
  const bearer = getBearerToken(req);
  if (bearer && isSystemToken(bearer)) {
    return { type: "admin", email: "system@jitsu.com" };
  }

  // 2. End-user Firebase token.
  const firebaseToken = getFirebaseToken(req);
  if (!firebaseToken) {
    res.status(401).json({ ok: false, error: "No authorization provided" });
    return undefined;
  }
  let decoded: Awaited<ReturnType<typeof verifyFirebaseToken>>;
  try {
    decoded = await verifyFirebaseToken(firebaseToken);
  } catch (e) {
    log
      .atWarn()
      .withCause(e)
      .log(`Failed to verify Firebase token: ${getErrorMessage(e)}`);
    res.status(401).json({ ok: false, error: "Invalid or expired authentication" });
    return undefined;
  }
  const email = decoded.email;
  if (!email) {
    res.status(401).json({ ok: false, error: "Firebase token has no email" });
    return undefined;
  }
  // A Firebase email is trustworthy only once verified. Email/password signup
  // issues a usable ID token immediately with email_verified=false, and the
  // Firebase project's signup API is public — without this check anyone could
  // register as `anything@jitsu.com` and, if that domain is on
  // JITSU_EE_ADMINS, be granted admin. OAuth providers verify the address
  // themselves, so this only ever rejects unverified email/password accounts.
  if (decoded.email_verified !== true) {
    log.atWarn().log(`Rejected request from unverified email: ${email}`);
    res.status(401).json({ ok: false, error: "Email is not verified" });
    return undefined;
  }
  // `internalId` is a custom claim set by console (linkFirebaseUser).
  const userId = (decoded as Record<string, any>).internalId as string | undefined;
  const type = isAdminEmail(email) ? "admin" : "user";
  log.atInfo().log(`Authenticated ${type} ${email}${userId ? ` (user ${userId})` : ""}`);
  return { type, email, userId };
}

/**
 * Assert that `claims` may act on `workspaceId`. Admins pass unconditionally;
 * a regular user must be a member of the workspace. Membership is read straight
 * from the `newjitsu` schema (owned by console) — ee-api no longer trusts a
 * workspace id asserted inside a token.
 *
 * Throws `WorkspaceNotFoundError` (→ 404) when the workspace doesn't exist, or
 * `AccessDeniedError` (→ 403) when it does but the user can't act on it.
 * `withErrorHandler` translates both to the right HTTP status.
 */
export async function requireWorkspaceAccess(claims: AuthClaims, workspaceId: string): Promise<void> {
  if (claims.type === "admin") {
    return;
  }
  assertDefined(workspaceId, "workspaceId is required");
  const userId = requireDefined(claims.userId, `Authenticated user ${claims.email} has no internal id`);
  // One round-trip that disambiguates "no workspace" (404) from "no access" (403):
  // workspace-row presence + an EXISTS for the access link. No rows → not found;
  // row with has_access=false → forbidden; row with has_access=true → pass.
  const rows = await prisma.$queryRaw<{ has_access: boolean }[]>`
    select exists(
      select 1 from newjitsu."WorkspaceAccess"
      where "userId" = ${userId} and "workspaceId" = w.id
    ) as has_access
    from newjitsu."Workspace" w
    where (w.id = ${workspaceId} or w.slug = ${workspaceId}) and w.deleted = false
    limit 1`;
  if (rows.length === 0) {
    throw new WorkspaceNotFoundError(workspaceId);
  }
  if (!rows[0].has_access) {
    throw new AccessDeniedError(`User ${claims.email} doesn't have access to workspace ${workspaceId}`);
  }
}

/** Typed errors that `withErrorHandler` maps to specific HTTP statuses. */
export class AccessDeniedError extends Error {
  readonly httpStatus = 403;
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}
export class WorkspaceNotFoundError extends Error {
  readonly httpStatus = 404;
  constructor(workspaceId: string) {
    super(`Workspace ${workspaceId} not found`);
    this.name = "WorkspaceNotFoundError";
  }
}
