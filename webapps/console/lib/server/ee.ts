import { getErrorMessage, getLog, requireDefined, rpc } from "juava";
import { NextApiRequest } from "next";
import { getServerEnv } from "./serverEnv";
import { firebaseAuthCookieName } from "./firebase-server";

export function isEEAvailable(): boolean {
  return !!getServerEnv().EE_CONNECTION;
}

export type EeConnection = {
  host: string;
};

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
  const url = new URL(
    requireDefined(getServerEnv().EE_CONNECTION, `env EE_CONNECTION is not set. Call isEEAvailable()`)
  );
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

export async function onUserCreated(req: NextApiRequest | undefined, opts: { email: string; name?: string }) {
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
        ...eeAuthHeaders(requireDefined(req, `request is required to authenticate to ee-api`)),
      },
    });
  } catch (e: any) {
    getLog()
      .atError()
      .log(`Error sending user (${JSON.stringify(opts)}) created event to EE: ${getErrorMessage(e)}`, e);
  }
}
