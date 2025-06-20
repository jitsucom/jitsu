import { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { getServerLog } from "../../../../lib/server/log";
import { nextAuthConfig } from "../../../../lib/nextauth.config";

const log = getServerLog("api/auth/oidc-session");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Check for OIDC session cookie
    const oidcSessionCookie = req.cookies?.["oidc-session"];

    if (!oidcSessionCookie) {
      return res.status(200).json({ authenticated: false });
    }

    // Verify the session token
    let sessionData: {
      userId: string;
      email: string;
      name: string;
      loginProvider: string;
      externalId: string;
      timestamp: number;
      exp: number;
    };

    try {
      sessionData = jwt.verify(oidcSessionCookie, nextAuthConfig.secret as string) as any;
    } catch (err) {
      log.atError().withCause(err).log("Invalid OIDC session token");
      return res.status(200).json({ authenticated: false });
    }

    // Return user data (without sensitive information)
    return res.status(200).json({
      authenticated: true,
      user: {
        email: sessionData.email,
        name: sessionData.name,
        internalId: sessionData.userId,
        loginProvider: sessionData.loginProvider,
        externalId: sessionData.externalId,
      },
    });
  } catch (error: any) {
    log.atError().withCause(error).log("Error checking OIDC session");
    return res.status(500).json({ error: "Internal server error" });
  }
}
