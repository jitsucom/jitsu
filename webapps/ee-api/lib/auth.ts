import { NextApiRequest, NextApiResponse } from "next";
import { assertDefined, createAuthorized, getLog, newError, requireDefined } from "juava";

import jwt from "jsonwebtoken";
import * as process from "process";

const bearerPrefix = "Bearer ";

const log = getLog("auth");

const adminAuthorizer = createAuthorized(process.env.EE_API_AUTH_TOKENS || "");

type UserAuthClaim = {
  type: "user";
  workspaceId: string;
  userId: string;
};
type AdminAuthClaim = { type: "admin" };
export type AuthClaims = UserAuthClaim | AdminAuthClaim;

async function decryptJWT(token: string): Promise<UserAuthClaim | undefined> {
  const secret = requireDefined(process.env.JWT_SECRET, `env JWT_SECRET is not set`);
  let decoded: any;
  try {
    decoded = jwt.verify(token, secret);
  } catch (e: any) {
    throw newError(e, `JWT verification failed`);
  }
  assertDefined(decoded.exp, `expiration is not set`);
  assertDefined(decoded.workspaceId, `workspaceId is a required field`);
  assertDefined(decoded.userId, `userId is a required field`);
  log
    .atInfo()
    .log(
      `Authenticated user ${decoded.userId} in workspace ${decoded.workspaceId}. Token expires at: ${new Date(
        decoded.exp * 1000
      )}`
    );
  return { type: "user", workspaceId: decoded.workspaceId, userId: decoded.userId };
}

export async function auth(req: NextApiRequest, res: NextApiResponse): Promise<AuthClaims | undefined> {
  if (
    process.env.EE_DISABLE_AUTH === "true" ||
    process.env.EE_DISABLE_AUTH === "yes" ||
    process.env.EE_DISABLE_AUTH === "1"
  ) {
    log.atInfo().log("=======ATTENTION! AUTHENTICATION IS DISABLED! USE FOR DEVELOPMENT ONLY =======");
    return { type: "admin" };
  }

  const authVal = req.headers.authorization;
  if (!authVal) {
    res.status(401).json({ ok: false, error: "No authorization header" });
    return undefined;
  }
  if (authVal.indexOf(bearerPrefix) !== 0) {
    res.status(401).json({ ok: false, error: `Auth header should start with ${bearerPrefix}` });
    return undefined;
  }
  const token = authVal.substring(bearerPrefix.length);
  if (adminAuthorizer(token)) {
    return { type: "admin" };
  }
  if (typeof req.query.__auth === "string" && adminAuthorizer(req.query.__auth)) {
    return { type: "admin" };
  }
  if (process.env.JWT_SECRET) {
    try {
      const decrypted = await decryptJWT(token);
      if (decrypted) {
        if (decrypted?.workspaceId == "$all") {
          //change to admin claim
          return { type: "admin" };
        }
        return decrypted;
      } else {
        res.status(401).json({ ok: false, error: `Invalid JWT token. Code: MAYBE_EXPIRED` });
        return undefined;
      }
    } catch (e) {
      log.atError().withCause(e).log(`Failed to decrypt token: ${e}`);
      res.status(401).json({ ok: false, error: `Invalid JWT token. Code: DECRYPT_EXCEPTION` });
      return undefined;
    }
  } else {
    res.status(401).json({ ok: false, error: `Invalid token` });
    return undefined;
  }
}
