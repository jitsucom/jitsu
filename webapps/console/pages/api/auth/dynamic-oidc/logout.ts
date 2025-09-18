import { NextApiRequest, NextApiResponse } from "next";
import { serialize } from "cookie";
import { getServerLog } from "../../../../lib/server/log";
import { isSecure } from "../../../../lib/server/origin";

const log = getServerLog("api/auth/oidc-logout");

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
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
