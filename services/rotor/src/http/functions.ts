import { getLog, requireDefined } from "juava";
import { IngestMessage } from "@jitsu/protocols/async-request";
import { Metrics } from "../lib/metrics";
import { GeoResolver } from "../lib/maxmind";
import { rotorMessageHandler } from "../lib/message-handler";
import { CONNECTION_IDS_HEADER } from "../lib/rotor";
import { AnyEvent } from "@jitsu/protocols/functions";
import isEqual from "lodash/isEqual";
import { parse as semverParse } from "semver";
import * as jsondiffpatch from "jsondiffpatch";

import Prometheus from "prom-client";
import { EventsStore } from "@jitsu/core-functions";
import { connectionsStore, functionsStore } from "../lib/entity-store";

const jsondiffpatchInstance = jsondiffpatch.create();
const log = getLog("functions_handler");

const handlerMetric = new Prometheus.Counter({
  name: "rotor_function_handler",
  help: "function handler status",
  labelNames: ["connectionId", "status"] as const,
});

export const FunctionsHandler =
  (eventsLogger: EventsStore, metrics: Metrics, geoResolver?: GeoResolver) => async (req, res) => {
    const message = req.body as IngestMessage;
    //log.atInfo().log(`Functions handler. Message ID: ${message.messageId} connectionId: ${message.connectionId}`);
    const result = await rotorMessageHandler(message, {
      connectionStore: requireDefined(connectionsStore.getCurrent(), "Connection store is not initialized"),
      functionsStore: requireDefined(functionsStore.getCurrent(), "Functions store is not initialized"),
      eventsLogger,
      metrics,
      geoResolver,
    });
    if (result?.events && result.events.length > 0) {
      res.json(result.events);
    } else {
      res.status(204).send();
    }
  };

export const FunctionsHandlerMulti =
  (eventsLogger: EventsStore, metrics: Metrics, geoResolver?: GeoResolver) => async (req, res, next) => {
    const connectionIds = (req.query.ids ?? "").split(",") as string[];
    const message = req.body as IngestMessage;
    const functionsFetchTimeout = req.headers["x-request-timeout-ms"]
      ? parseInt(req.headers["x-request-timeout-ms"] as string)
      : 2000;
    const prom = connectionIds
      .filter(id => !!id)
      .map(id => {
        //log.atInfo().log(`Functions handler2. Message ID: ${message.messageId} connectionId: ${id}`);
        return rotorMessageHandler(
          message,
          {
            connectionStore: requireDefined(connectionsStore.getCurrent(), "Connection store is not initialized"),
            functionsStore: requireDefined(functionsStore.getCurrent(), "Functions store is not initialized"),
            eventsLogger,
            metrics,
            geoResolver,
          },
          "all",
          { [CONNECTION_IDS_HEADER]: id },
          false,
          0,
          functionsFetchTimeout
        );
      });
    await Promise.all(prom)
      .then(results => {
        connectionIds.forEach((id, i) => {
          handlerMetric.inc({ connectionId: id, status: "success" }, 1);
        });
        const events = Object.fromEntries(
          results.map(result => [result?.connectionId, mapDiff(message, result?.events)])
        );
        res.json(events);
      })
      .catch(e => {
        connectionIds.forEach((id, i) => {
          handlerMetric.inc({ connectionId: id, status: "error" }, 1);
        });
        next(e);
      });
  };

function mapDiff(message: IngestMessage, newEvents?: AnyEvent[]) {
  if (!newEvents) {
    return [];
  }

  return newEvents.map(e => {
    if (isEqual(message.httpPayload, e)) {
      return "same";
    }
    let supportsDiff = false;
    const library = message.httpPayload?.context?.library;
    if (library?.name === "@jitsu/js") {
      const semver = semverParse(library.version);
      if (semver && semver.major >= 2) {
        supportsDiff = true;
      }
    }
    if (!supportsDiff) {
      return e;
    }

    const originalSize = JSON.stringify(message.httpPayload).length;
    const diff = jsondiffpatchInstance.diff(message.httpPayload, e);
    if (!diff) {
      return "same";
    }
    const diffSize = JSON.stringify(diff).length;
    if (diffSize > originalSize) {
      return e;
    } else {
      return { __diff: diff };
    }
  });
}
