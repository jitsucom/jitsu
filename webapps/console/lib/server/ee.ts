import { getErrorMessage, getLog, requireDefined, rpc } from "juava";
import { NextApiRequest } from "next";
import { getServerEnv } from "./serverEnv";
import { firebaseAuthCookieName } from "./firebase-server";
import type { SessionUser } from "../schema";

export function isEEAvailable(): boolean {
  return !!getServerEnv().EE_CONNECTION;
}

export type EeConnection = {
  host: string;
};

/**
 * Expand `${VAR}` placeholders in an env value against `process.env`. Lets dev
 * env files address sibling portless hosts that vary by branch, e.g.
 *   EE_CONNECTION=https://ee${JITSU_BRANCH_SUFFIX}.jitsu.localhost/
 * `JITSU_BRANCH_SUFFIX` is set by `dev-scripts/run-app.ts` — either
 * `-<branch>` or empty (default branch / --no-branch). Production literal URLs
 * have no `${}` and pass through unchanged. Throws on a placeholder whose var
 * isn't set — silent empty-substitution would produce a malformed URL with no
 * trace.
 */
const TEMPLATE_VAR_RE = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
function expandEnvTemplate(raw: string): string {
  return raw.replace(TEMPLATE_VAR_RE, (_, name) => {
    // Dynamic var name — `serverEnv` only types the known schema, but template
    // placeholders may reference vars (like `JITSU_BRANCH_SUFFIX`) set by the
    // dev runner outside that schema. Reading raw `process.env` is the right
    // tool here.
    // eslint-disable-next-line no-restricted-properties
    const v = process.env[name];
    if (v === undefined) {
      throw new Error(`env template references unset variable \${${name}}: ${raw}`);
    }
    return v;
  });
}

/**
 * Bearer headers for console's server-to-server calls to ee-api that have no
 * signed-in user (the scheduled-sync quota check, the bulker connections
 * export). `EE_API_SERVICE_TOKEN` is required.
 */
export function serviceTokenHeaders(): Record<string, string> {
  const token = requireDefined(getServerEnv().EE_API_SERVICE_TOKEN, `env EE_API_SERVICE_TOKEN is not set`);
  return { Authorization: `Bearer ${token}` };
}

/**
 * Parse `EE_CONNECTION` — the base URL of ee-api, e.g. `https://ee.jitsu.com/`.
 * Any query params are stripped: older configs carried a `jwtSecret` there to
 * sign a console-minted token, which is gone — ee-api now authenticates the
 * caller's forwarded Firebase token directly.
 */
export function getEeConnection(): EeConnection {
  if (!isEEAvailable()) {
    throw new Error("EE is not available");
  }
  const raw = requireDefined(getServerEnv().EE_CONNECTION, `env EE_CONNECTION is not set. Call isEEAvailable()`);
  const url = new URL(expandEnvTemplate(raw));
  url.search = "";
  return { host: url.toString() };
}

/**
 * Headers that forward the signed-in user's Firebase credential to ee-api.
 * `req` is the incoming console request; its `jitsu-auth` Firebase session
 * cookie is passed on as `x-fb-auth`. ee-api verifies it and resolves the user
 * (and their admin status) itself.
 */
export function eeAuthHeaders(req: NextApiRequest): Record<string, string> {
  const firebaseToken = requireDefined(
    req.cookies[firebaseAuthCookieName],
    `No Firebase session on the request — cannot authenticate to ee-api`
  );
  return { "x-fb-auth": firebaseToken };
}

/**
 * Pick auth headers for a console→ee-api call based on *how the inbound caller
 * was actually authenticated*, not what cookies they sent.
 *
 * Cookie presence alone is attacker-controlled — an API-key-authenticated
 * caller can attach a junk `jitsu-auth` cookie, forcing the Firebase path and
 * sending garbage to ee-api. The downstream 401 then gets swallowed by
 * `checkQuota`'s catch (and similar fail-open paths), bypassing the check.
 *
 * Only forward the cookie when the inbound `SessionUser` was tagged
 * `authType === "firebase"` by `getFirebaseUser` — meaning we already verified
 * the cookie ourselves on the inbound side. Every other auth type (bearer
 * API key, OIDC, NextAuth) gets the service token.
 */
export function eeAuthHeadersOrServiceToken(
  req: NextApiRequest,
  user?: Pick<SessionUser, "authType"> | null
): Record<string, string> {
  if (user?.authType === "firebase" && req.cookies[firebaseAuthCookieName]) {
    return eeAuthHeaders(req);
  }
  return serviceTokenHeaders();
}

export async function onUserCreated(opts: { email: string; name?: string }) {
  if (!isEEAvailable()) {
    return;
  }
  const { host } = getEeConnection();
  try {
    await rpc(`${host}api/user-created`, {
      method: "POST",
      body: opts,
      headers: {
        "Content-Type": "application/json",
        // System-to-system event: ee-api just needs to know a new user exists.
        // Some callers (the NextAuth `jwt` callback) have no request object at
        // all, so a Firebase-cookie forward isn't even an option.
        ...serviceTokenHeaders(),
      },
    });
  } catch (e: any) {
    // Swallow on purpose: console has already created the UserProfile row, and
    // we don't want a transient ee-api outage to fail signup. The trade-off is
    // that the user's Stripe customer / billing settings won't be provisioned
    // until somebody manually re-runs this — emit a structured, distinctive
    // log line so monitoring can alert and an admin can backfill.
    getLog()
      .atError()
      .log(
        `ACTION_REQUIRED: ee-api user-created sync failed; manual backfill needed. ` +
          `email=${opts.email} reason=${getErrorMessage(e)}`,
        e
      );
  }
}
