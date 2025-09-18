import { NextApiRequest } from "next";

export function getRequestHost(req: NextApiRequest) {
  return (req.headers["x-forwarded-host"] || req.headers.host) as string;
}

export function getTopLevelDomain(requestDomain: string): string {
  const parts = requestDomain.split(".");
  if (parts.length < 2) {
    return parts[0];
  }
  return parts.slice(-2).join(".");
}

export function isSecure(req: NextApiRequest) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (forwardedProto === "https") {
    return true;
  }
  return !!((req.socket || {}) as any).encrypted;
}
