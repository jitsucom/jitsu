import { z } from "zod";
import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import get from "lodash/get";
import set from "lodash/set";
import merge from "lodash/merge";
import { createFunctionLogger, JitsuFunctionWrapper } from "./lib";
import { requireDefined } from "juava";

export const UserRecognitionConfig = z.object({
  /**
   * Where to look for anonymous id, an array of JSON paths
   * ["anonymousId", "context.AnonymousId"]
   */
  anonymousIdFields: z.array(z.string()).default(["anonymousId"]),
  identifierFields: z.array(z.string()).default(["userId", "context.traits"]),
  eventTypes: z.array(z.string()).default(["page", "track", "screen"]),
  lookbackWindowDays: z.number().default(30),
  collectionId: z.string().default(""),
});

export type UserRecognitionConfig = z.infer<typeof UserRecognitionConfig>;

// const DefaultConfig: UserRecognitionConfig = UserRecognitionConfig.parse({});

const UserRecognitionFunction: JitsuFunctionWrapper<AnalyticsServerEvent, UserRecognitionConfig> = (
  chainCtx,
  funcCtx
) => {
  const log = createFunctionLogger(chainCtx, funcCtx);
  const props = funcCtx.props;

  const func: JitsuFunction<AnalyticsServerEvent> = async (event, ctx) => {
    if (!ctx.connection?.options.deduplicate || !ctx.connection?.options.primaryKey) {
      log.error(
        `User Recognition function requires connection to be configured with 'deduplicate' and 'primaryKey' options.`
      );
      return event;
    }
    const config = UserRecognitionConfig.parse(props || {});
    if (!config.eventTypes.includes(event.type)) {
      log.debug(`Event type ${event.type} is not in the list of event types to process. Message ID:${event.messageId}`);
    }
    const anonEvStore = requireDefined(chainCtx.anonymousEventsStore, "Anonymous events store is not defined");

    const collectionName = `UR_${config.collectionId ? `${config.collectionId}_` : ""}${ctx.connection?.id}`;

    const anonId = getAnonId(event, config.anonymousIdFields);
    if (!anonId) {
      log.warn(`No anonymous id found. Message ID:${event.messageId}`);
      return event;
    }
    const identifiedFields = getIdentifiedFields(event, config.identifierFields);
    if (!identifiedFields) {
      try {
        await anonEvStore.addEvent(collectionName, anonId, event, config.lookbackWindowDays);
        log.debug(
          `Event for for anonymous id: ${anonId} inserted to User Recognition collection. Message ID:${event.messageId}`
        );
      } catch (e) {
        log.error(
          `Failed to insert anonymous event for anonymous id: ${anonId} to User Recognition collection. Message ID:${event.messageId} Error: ${e}`
        );
      }
      return event;
    }
    // evict anonymous events from user_recognition collection
    const res = await anonEvStore.evictEvents(collectionName, anonId).then(evs => {
      return evs.map(anonEvent => {
        //merge anonymous event with identified fields
        return merge(anonEvent, identifiedFields);
      });
    });
    if (res.length === 0) {
      log.debug(
        `No events found for anonymous id: ${anonId} with identified fields: ${JSON.stringify(
          identifiedFields
        )} Message ID:${event.messageId}`
      );
      return event;
    } else {
      log.info(
        `${res.length} events for anonymous id: ${anonId} was updated with id fields: ${JSON.stringify(
          identifiedFields
        )} by Message ID:${event.messageId}`
      );
      return [event, ...res];
    }
  };

  return func;
};

function getAnonId(event: AnalyticsServerEvent, anonymousId: string[]): string | undefined {
  for (const path of anonymousId) {
    const id = get(event, path);
    if (id) {
      return id;
    }
  }
  return undefined;
}

function getIdentifiedFields(event: AnalyticsServerEvent, identifierFields: string[]): any | undefined {
  const res = {};
  let found = false;
  for (const path of identifierFields) {
    const f = get(event, path);
    if (f && !(typeof f === "object" && Object.keys(f).length === 0)) {
      found = true;
      set(res, path, f);
    }
  }
  if (!found) {
    return undefined;
  }
  return res;
}

export default UserRecognitionFunction;
