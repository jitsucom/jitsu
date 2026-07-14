import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { CreateUserResult } from "../../../lib/schema";
import { isPersonalEmailSignupBlocked } from "../../../lib/server/signup-restrictions";
import { WORK_EMAIL_REQUIRED_MESSAGE } from "../../../lib/shared/email-domains";

/**
 * JITSU-70: pre-signup check for the email/password path. The form calls this
 * before creating the Firebase account so a personal-email signup is refused
 * upfront (no account, no verification email) instead of only after the user
 * verifies. The policy + domain list stay server-side; the typed result mirrors
 * create-user. create-user / init-user remain the authoritative backstops.
 */
export default createRoute()
  .POST({
    auth: false,
    // A pure policy check that touches no DB — keep it working during maintenance
    // so the signup form stays responsive.
    allowDuringMaintenance: true,
    body: z.object({ email: z.string() }),
    result: CreateUserResult,
  })
  .handler(async ({ body }) => {
    if (isPersonalEmailSignupBlocked({ email: body.email })) {
      return { ok: false, rejected: "personal-email", message: WORK_EMAIL_REQUIRED_MESSAGE } as const;
    }
    return { ok: true } as const;
  })
  .toNextApiHandler();
