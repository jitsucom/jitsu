import type { NextApiRequest, NextApiResponse } from "next";
import { randomUUID } from "crypto";

const USER_COOKIE = "__eventn_uid";
const ANON_COOKIE = "__eventn_id";

function getDomain(request: NextApiRequest) {
  let domain = request.query.domain;
  if (domain) {
    return domain;
  }
  domain = request.headers.host?.toString() ?? "";
  if (domain.startsWith("localhost")) return "localhost";
  return domain;
}

function renewCookies(
  request: NextApiRequest,
  response: NextApiResponse,
  browserName: string,
  serverName: string,
  generateNew: boolean = false
) {
  let cookie = request.cookies[browserName] || request.cookies[serverName];
  if (!cookie) {
    if (!generateNew) return;
    cookie = randomUUID();
  }
  const secure = request.headers["x-forwarded-proto"] === "https";
  const maxAge = 31_536_000 * 5; // 5 years in seconds
  const domain = getDomain(request);
  response.setHeader("Set-Cookie", [
    ...((response.getHeader("Set-Cookie") as string[]) ?? []),
    `${browserName}=${cookie}; Max-Age=${maxAge}; Domain=${domain}; Path=/; SameSite=${secure ? "None" : "Lax"};${
      secure ? " Secure;" : ""
    }`,
    `${serverName}=${cookie}; Max-Age=${maxAge}; Domain=${domain}; Path=/; SameSite=${secure ? "None" : "Lax"};${
      secure ? " Secure;" : ""
    } httpOnly=true;`,
  ]);
  return cookie;
}

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  renewCookies(request, response, ANON_COOKIE, `${ANON_COOKIE}_srvr`, true);
  renewCookies(request, response, USER_COOKIE, `${USER_COOKIE}_srvr`);
  response.setHeader("Cache-Control", "must-revalidate,no-cache,no-store");
  response.send("OK");
}
