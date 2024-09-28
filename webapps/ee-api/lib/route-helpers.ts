import { getErrorMessage } from "juava";
import { NextApiHandler, NextApiRequest } from "next";
import { getServerLog } from "./log";

const log = getServerLog("api-error");

export function withErrorHandler(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    try {
      const result = await handler(req, res);
      if (!res.headersSent && result) {
        res.status(200).json(result);
      } else if (!res.headersSent) {
        res.status(200).end();
      }
    } catch (err) {
      log.atError().withCause(err).log(`Error handling API request: ${req.method} ${req.url}`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: getErrorMessage(err) });
      } else {
        log.atWarn().log(`Response already sent, not sending error message`);
      }
    }
  };
}

export function getOrigin(req: NextApiRequest) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const forwardedPort = req.headers["x-forwarded-port"];
  const protocol = forwardedProto || (process.env.NODE_ENV === "production" ? "https" : "http");
  const host = forwardedHost || req.headers["host"];
  const port = forwardedPort && !host?.includes(":") ? `:${forwardedPort}` : "";
  return `${protocol}://${host}${port}`;
}
