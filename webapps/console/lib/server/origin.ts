import { NextApiRequest } from "next";

export function getRequestHost(req: NextApiRequest) {
  return (req.headers["x-forwarded-host"] || req.headers.host) as string;
}
