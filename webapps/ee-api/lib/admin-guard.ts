/**
 * Server-side guard for the admin UI. Resolves the current admin from the
 * Firebase session cookie and gates `getServerSideProps` on the
 * `JITSU_EE_ADMINS` allow-list.
 */
import { GetServerSidePropsContext, GetServerSidePropsResult } from "next";
import {
  firebaseAuthCookieName,
  getFirebaseOptions,
  isFirebaseEnabled,
  verifyFirebaseSessionCookie,
} from "./firebase-auth";
import { isAdminEmail } from "./admins";
import { getServerLog } from "./log";

const log = getServerLog("admin-guard");

export type AdminUser = { email: string };

/**
 * Resolve the signed-in admin from the request's session cookie. Returns null
 * when there is no cookie, the cookie is invalid, or the email is not on the
 * `JITSU_EE_ADMINS` allow-list.
 */
export async function resolveAdmin(req: GetServerSidePropsContext["req"]): Promise<AdminUser | null> {
  if (!isFirebaseEnabled()) {
    return null;
  }
  const token = req.cookies[firebaseAuthCookieName];
  if (!token) {
    return null;
  }
  try {
    const decoded = await verifyFirebaseSessionCookie(token);
    if (decoded.email && isAdminEmail(decoded.email)) {
      return { email: decoded.email };
    }
    return null;
  } catch (e) {
    log.atWarn().withCause(e).log("Failed to verify session cookie");
    return null;
  }
}

/** Firebase client config exposed to the browser for the sign-in flow. */
export function getFirebaseClientConfig(): Record<string, any> | null {
  return getFirebaseOptions()?.client ?? null;
}

/**
 * `getServerSideProps` helper for protected pages: redirects to `/login` when
 * the visitor is not an authorized admin.
 */
export async function requireAdmin(
  ctx: GetServerSidePropsContext
): Promise<GetServerSidePropsResult<{ email: string }>> {
  const admin = await resolveAdmin(ctx.req);
  if (!admin) {
    return { redirect: { destination: "/login", permanent: false } };
  }
  return { props: { email: admin.email } };
}
