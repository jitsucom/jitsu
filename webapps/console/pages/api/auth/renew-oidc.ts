import { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { getServerLog } from "../../../lib/server/log";
import { serialize } from "cookie";
import { nextAuthConfig } from "../../../lib/nextauth.config";

const log = getServerLog("api/auth/renew-oidc");

// TODO: Use proper OIDC refresh token flow when available
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Check for existing OIDC session cookie
    const oidcSessionCookie = req.cookies?.["oidc-session"];
    if (!oidcSessionCookie) {
      return res.status(401).json({ error: "No OIDC session found" });
    }

    // Verify the current token
    let sessionData: {
      userId: string;
      email: string;
      name: string;
      loginProvider: string;
      externalId: string;
      timestamp: number;
    };

    try {
      sessionData = jwt.verify(oidcSessionCookie, nextAuthConfig.secret as string) as any;
    } catch (err) {
      log.atError().withCause(err).log("Invalid OIDC session token");
      return res.status(401).json({ error: "Invalid session token" });
    }

    // Create a new session token with updated timestamp
    const newSessionData = {
      ...sessionData,
      timestamp: Date.now(),
    };

    const newSessionToken = jwt.sign(newSessionData, nextAuthConfig.secret as string, {
      expiresIn: "24h",
    });

    // Set the renewed cookie
    res.setHeader(
      "Set-Cookie",
      serialize("oidc-session", newSessionToken, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60, // 24 hours
        path: "/",
      })
    );

    log.atInfo().log("OIDC session renewed", { email: sessionData.email });

    return res.status(200).json({ success: true, message: "Session renewed" });
  } catch (error: any) {
    log.atError().withCause(error).log("Error renewing OIDC session");
    return res.status(500).json({ error: "Internal server error" });
  }
}
