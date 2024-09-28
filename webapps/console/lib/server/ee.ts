import { getErrorMessage, getLog, requireDefined, rpc } from "juava";
import jwt from "jsonwebtoken";

export function isEEAvailable(): boolean {
  return !!process.env.EE_CONNECTION;
}

export type EeConnection = {
  host: string;
  jwtSecret: string;
};

export function getEeConnection(): EeConnection {
  if (!isEEAvailable()) {
    throw new Error("EE is not available");
  }
  const url = new URL(requireDefined(process.env.EE_CONNECTION, `env EE_CONNECTION is not set. Call isEEAvailable()`));
  const jwtSecret = url.searchParams.get("jwtSecret");
  if (!jwtSecret) {
    throw new Error("EE connection URL must contain jwtSecret param");
  }
  url.searchParams.delete("jwtSecret");
  return {
    host: url.toString(),
    jwtSecret,
  };
}

type JWTResult = {
  //JWT token,
  jwt: string;
  //Token expiration date as ISO UTC
  expiresAt: string;
};

export function createSystemJwt(): JWTResult {
  return createJwt("admin-service-account@jitsu.com", "admin-service-account@jitsu.com", "$all", 60);
}

export function createJwt(userId: string, email: string, workspaceId: string, expireInSecs: number): JWTResult {
  if (!isEEAvailable()) {
    throw new Error("EE is not available");
  }
  const jwtSecret = getEeConnection().jwtSecret;
  const expiresSecondsTimestamp = new Date().getTime() / 1000 + expireInSecs;
  const token = jwt.sign({ userId, email, workspaceId, exp: expiresSecondsTimestamp }, jwtSecret);
  return { jwt: token, expiresAt: new Date(expiresSecondsTimestamp * 1000).toISOString() };
}

export async function onUserCreated(opts: { email: string; name?: string }) {
  if (!isEEAvailable()) {
    return;
  }
  const url = `${getEeConnection().host}api/user-created`;
  try {
    await rpc(url, {
      method: "POST",
      body: opts,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${createSystemJwt().jwt}`,
      },
    });
  } catch (e: any) {
    getLog()
      .atError()
      .log(`Error sending user (${JSON.stringify(opts)}) created event to EE: ${getErrorMessage(e)}`, e);
  }
}
