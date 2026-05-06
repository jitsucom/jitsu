import { NextApiRequest, NextApiResponse } from "next";
import { serialize } from "cookie";
import { getServerLog } from "../../../../lib/server/log";
import { isSecure } from "../../../../lib/server/origin";
import jwt from "jsonwebtoken";
import { nextAuthConfig } from "../../../../lib/nextauth.config";
import { OidcSessionData } from "../../../../lib/server/oidc-types";
import { authAuditLog } from "../../../../lib/server/audit-log";

const log = getServerLog("api/auth/oidc-logout");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Try to identify the user from the existing session before clearing it.
    const oidcSessionCookie = req.cookies?.["oidc-session"];
    if (oidcSessionCookie) {
      try {
        const sessionData = jwt.verify(oidcSessionCookie, nextAuthConfig.secret!) as OidcSessionData;
        if (sessionData?.userId) {
          await authAuditLog(
            {
              internalId: sessionData.userId,
              email: sessionData.email || "",
              name: sessionData.name || sessionData.email || "",
            },
            "logout",
            "oidc"
          );
        }
      } catch (err) {
        // Bad / expired cookie — nothing to log.
        log
          .atDebug()
          .withCause(err as Error)
          .log("Could not decode OIDC session cookie during logout");
      }
    }

    // Clear the OIDC session cookie
    res.setHeader(
      "Set-Cookie",
      serialize("oidc-session", "", {
        httpOnly: true,
        secure: isSecure(req),
        sameSite: "strict",
        expires: new Date(0), // Expire immediately
        path: "/",
      })
    );

    log.atInfo().log("OIDC session cleared");

    return res.status(200).json({ success: true });
  } catch (error: any) {
    log.atError().withCause(error).log("Error during OIDC logout");
    return res.status(500).json({ error: "Internal server error" });
  }
}
