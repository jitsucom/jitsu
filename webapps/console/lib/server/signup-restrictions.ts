import { firebase } from "./firebase-server";
import { getServerEnv } from "./serverEnv";
import { isPersonalEmail } from "../shared/email-domains";
import { getServerLog } from "./log";
import { db } from "./db";

const log = getServerLog("signup");

/**
 * JITSU-70 policy decision (no side effects): should a signup with this email be
 * refused because it comes from a personal domain and a work email is required?
 *
 * The rule is Firebase-only and exempts GitHub (devs often have a personal email
 * tied to their GitHub account). Firebase OAuth paths pass the provider as
 * `firebase/<sign_in_provider>`; the email precheck passes no provider, which is
 * the email/password path (never GitHub) and is always subject to the check.
 */
export function isPersonalEmailSignupBlocked(opts: { email: string; loginProvider?: string | null }): boolean {
  if (!getServerEnv().LIMIT_PERSONAL_EMAILS) {
    return false;
  }
  const provider = opts.loginProvider ?? "";
  if (provider && (!provider.startsWith("firebase/") || provider === "firebase/github.com")) {
    return false;
  }
  return isPersonalEmail(opts.email);
}

/**
 * Enforcement at a new-profile path (create-user, the init-user remediation
 * branch). When the signup must be rejected it deletes the orphaned Firebase
 * account so nothing lingers without a Jitsu profile and the user can retry
 * cleanly with a work email, then returns true. The caller surfaces the refusal.
 */
export async function shouldRejectPersonalEmailSignup(user: {
  email: string;
  loginProvider?: string | null;
  externalId?: string | null;
}): Promise<boolean> {
  if (!isPersonalEmailSignupBlocked(user)) {
    return false;
  }
  // Never reject a returning user. An existing account that lost its internalId
  // custom claim (claim reset / migration) still has a Jitsu profile and must be
  // relinked, not deleted. Match any Firebase-provider row for this externalId:
  // create-user stores `firebase`, init-user recovery stores `firebase/<provider>`.
  if (user.externalId) {
    const existing = await db
      .prisma()
      .userProfile.findFirst({ where: { externalId: user.externalId, loginProvider: { startsWith: "firebase" } } });
    if (existing) {
      return false;
    }
    // Truly new — delete the orphaned Firebase account so nothing lingers
    // without a Jitsu profile and the user can retry with a work email.
    try {
      await firebase().auth().deleteUser(user.externalId);
    } catch (e) {
      log.atWarn().withCause(e).log(`Failed to delete rejected personal-email firebase user ${user.externalId}`);
    }
  }
  log.atInfo().log(`Rejected personal-email signup: ${user.email} (${user.loginProvider})`);
  return true;
}
