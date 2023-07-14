import { requireDefined } from "juava";
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

export function createJwt(
  userId: string,
  email: string,
  workspaceId: string,
  expireInSecs: number
): {
  //JWT token,
  jwt: string;
  //Token expiration date as ISO UTC
  expiresAt: string;
} {
  if (!isEEAvailable()) {
    throw new Error("EE is not available");
  }
  const jwtSecret = getEeConnection().jwtSecret;
  const expiresSecondsTimestamp = new Date().getTime() / 1000 + expireInSecs;
  const token = jwt.sign({ userId, email, workspaceId, exp: expiresSecondsTimestamp }, jwtSecret);
  return { jwt: token, expiresAt: new Date(expiresSecondsTimestamp * 1000).toISOString() };
}

export type DomainStatus = { error?: string } & (
  | { needsConfiguration: false }
  | { needsConfiguration: true; configurationType: "cname"; cnameValue: string }
  | {
      needsConfiguration: true;
      configurationType: "verification";
      verification: { type: string; domain: string; value: string }[];
    }
);
