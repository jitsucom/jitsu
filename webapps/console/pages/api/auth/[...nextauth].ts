import { nextAuthConfigForRequest } from "../../../lib/nextauth.config";
import NextAuth from "next-auth";
import type { NextApiRequest, NextApiResponse } from "next";

// Per-request invocation (NextAuth(req, res, options)) so the signOut/jwt
// events in the config can attribute login/logout audit rows to the request's
// ip + headers.
export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  return NextAuth(req, res, nextAuthConfigForRequest(req));
}
