import { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import { getServerLog } from "../../../lib/server/log";
import { serialize } from "cookie";
import { nextAuthConfig } from "../../../lib/nextauth.config";

const log = getServerLog("api/auth/complete-oidc");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { token, workspace } = req.query;

  if (!token || typeof token !== "string") {
    return res.status(400).json({ error: "Token is required" });
  }

  try {
    // Verify and decode the temporary token
    let userData: {
      userId: string;
      email: string;
      name: string;
      loginProvider: string;
      externalId: string;
    };

    try {
      userData = jwt.verify(token, nextAuthConfig.secret as string) as any;
    } catch (err) {
      log.atError().withCause(err).log("Invalid token");
      return res.redirect("/?error=invalid_token");
    }

    // Create a session token that the Firebase frontend can use to sign in
    const sessionData = {
      ...userData,
      timestamp: Date.now(),
    };
    console.log("Session data for OIDC signin:", sessionData);

    const sessionToken = jwt.sign(sessionData, nextAuthConfig.secret as string);

    // Set a cookie that the frontend can read to complete the signin
    res.setHeader(
      "Set-Cookie",
      serialize("oidc-session", sessionToken, {
        httpOnly: false, // Frontend needs to read this
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 24 * 60 * 60, // 24 hours
        path: "/",
      })
    );

    // Redirect to the workspace or home page with completion flag
    const redirectUrl = workspace ? `/${workspace}` : "/";
    return res.redirect(`${redirectUrl}?oidc-complete=true`);
  } catch (error: any) {
    log.atError().withCause(error).log("Error completing OIDC signin");
    return res.redirect("/?error=complete_oidc_error");
  }
}
