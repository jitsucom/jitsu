import { getErrorMessage, getLog } from "juava";
import { NextApiHandler } from "next";

const log = getLog("api-error");

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
