import { getLog } from "juava";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { rotorMessageHandler } from "../index";

const log = getLog("functions_handler");

export const FunctionsHandler = metrics => async (req, res) => {
  const message = req.body as IngestMessage;
  log.atInfo().log(`Functions handler. Message ID: ${message.messageId} connectionId: ${message.connectionId}`);
  const result = await rotorMessageHandler(message, metrics);
  if (result?.events && result.events.length > 0) {
    res.json(result.events);
  } else {
    res.status(204).send();
  }
};
