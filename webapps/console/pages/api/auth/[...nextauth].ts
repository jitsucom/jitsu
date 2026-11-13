import { withAuthRateLimit, isNextAuthAttempt } from "../../../lib/server/rate-limit/auth";
import { nextAuthConfigForRequest } from "../../../lib/nextauth.config";
import NextAuth from "next-auth";
import type { NextApiRequest, NextApiResponse } from "next";

// Per-request invocation (NextAuth(req, res, options)) so the signOut/jwt
// events in the config can attribute login/logout audit rows to the request's
// ip + headers.
async function auth(req: NextApiRequest, res: NextApiResponse) {
  return NextAuth(req, res, nextAuthConfigForRequest(req));
}

export default withAuthRateLimit(auth, { bucket: "login", matches: isNextAuthAttempt });
