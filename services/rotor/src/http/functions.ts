import { getLog } from "juava";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { Metrics } from "../lib/metrics";
import { GeoResolver } from "../lib/maxmind";
import { rotorMessageHandler } from "../lib/message-handler";
import { CONNECTION_IDS_HEADER } from "../lib/rotor";
import { AnyEvent } from "@jitsu/protocols/functions";
import isEqual from "lodash/isEqual";

const log = getLog("functions_handler");

export const FunctionsHandler = (metrics: Metrics, geoResolver?: GeoResolver) => async (req, res) => {
  const message = req.body as IngestMessage;
  log.atInfo().log(`Functions handler. Message ID: ${message.messageId} connectionId: ${message.connectionId}`);
  const result = await rotorMessageHandler(message, {}, metrics, geoResolver);
  if (result?.events && result.events.length > 0) {
    res.json(result.events);
  } else {
    res.status(204).send();
  }
};

export const FunctionsHandlerMulti = (metrics: Metrics, geoResolver?: GeoResolver) => async (req, res) => {
  const connectionIds = (req.query.ids ?? "").split(",") as string[];
  const message = req.body as IngestMessage;
  const prom = connectionIds
    .filter(id => !!id)
    .map(id => {
      log.atInfo().log(`Functions handler2. Message ID: ${message.messageId} connectionId: ${id}`);
      return rotorMessageHandler(message, { [CONNECTION_IDS_HEADER]: id }, metrics, geoResolver);
    });
  const results = await Promise.all(prom);

  const events = Object.fromEntries(results.map(result => [result?.connectionId, mapTheSame(message, result?.events)]));
  res.json(events);
};

function mapTheSame(message: IngestMessage, newEvents?: AnyEvent[]) {
  if (!newEvents) {
    return [];
  }
  return newEvents.map(e => (isEqual(message.httpPayload, e) ? "same" : e));
}
