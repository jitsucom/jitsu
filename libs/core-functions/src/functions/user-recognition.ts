import { AnonymousEventsStore, JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { transfer } from "@jitsu/functions-lib";

export const UserRecognitionParameter = "_JITSU_UR_MESSAGE_ID";

const IDENTIFYING_TRAITS_ENV = "IDENTIFYING_TRAITS";

const lookbackWindowDays = 30;
const eventTypes = ["page", "track", "screen"];

const UserRecognitionFunction: JitsuFunction<AnalyticsServerEvent, any> = async (event, ctx) => {
  if (
    (!ctx.connection.options.deduplicate || !ctx.connection.options.primaryKey) &&
    ctx.destination.type !== "profiles"
  ) {
    ctx.log.error(
      `User Recognition function requires connection to be configured with 'deduplicate' and 'primaryKey' options.`
    );
    return event;
  }
  const anonId = event.anonymousId;
  if (!anonId) {
    ctx.log.warn(`No anonymous id found. Message ID:${event.messageId}`);
    return event;
  }
  const userId = event.userId;
  const identifyingTraits = ctx.connection.options?.functionsEnv?.[IDENTIFYING_TRAITS_ENV]
    ? ctx.connection.options.functionsEnv[IDENTIFYING_TRAITS_ENV].split(",").map((t: string) => t.trim())
    : [];
  let identifiedEvent = !!userId;

  const anonEvStore = ctx["anonymousEventsStore"] as AnonymousEventsStore;
  const collectionName = `UR_${ctx.connection?.id}`;

  if (event.type === "identify") {
    if (!identifiedEvent && identifyingTraits.length > 0) {
      const traits = event.traits || {};
      for (const trait of identifyingTraits) {
        if (traits[trait]) {
          identifiedEvent = true;
          break;
        }
      }
    }
    if (identifiedEvent) {
      const identifiedFields = {
        userId,
        context: {
          traits: event.traits,
        },
      };
      // evict anonymous events from user_recognition collection
      const res = await anonEvStore.evictEvents(collectionName, anonId).then(evs => {
        return evs.map(anonEvent => {
          //merge anonymous event with identified fields
          anonEvent.userId = userId;
          anonEvent.context = anonEvent.context || {};
          if (!anonEvent.context.traits) {
            anonEvent.context.traits = event.traits || {};
          } else {
            transfer(anonEvent.context.traits, event.traits);
          }
          anonEvent[UserRecognitionParameter] = event.messageId;
          return anonEvent;
        });
      });
      if (res.length === 0) {
        ctx.log.debug(
          `No events found for anonymous id: ${anonId} with identified fields: ${JSON.stringify(
            identifiedFields
          )} Message ID:${event.messageId}`
        );
      } else {
        ctx.log.info(
          `${res.length} events for anonymous id: ${anonId} was updated with id fields: ${JSON.stringify(
            identifiedFields
          )} by Message ID:${event.messageId}`
        );
        return [event, ...res];
      }
    } else {
      ctx.log.debug(
        `Identify event with not enough identifying information. UserId: ${userId} and traits: ${JSON.stringify(
          event.traits
        )}. Message ID:${event.messageId}`
      );
    }
  } else if (eventTypes.includes(event.type)) {
    if (!identifiedEvent && identifyingTraits.length > 0) {
      const traits = event.context?.traits || {};
      for (const trait of identifyingTraits) {
        if (traits[trait]) {
          identifiedEvent = true;
          break;
        }
      }
    }
    if (!identifiedEvent) {
      try {
        await anonEvStore.addEvent(collectionName, anonId, event, lookbackWindowDays);
        ctx.log.debug(
          `Event for for anonymous id: ${anonId} inserted to User Recognition collection. Message ID:${event.messageId}`
        );
      } catch (e) {
        ctx.log.error(
          `Failed to insert anonymous event for anonymous id: ${anonId} to User Recognition collection. Message ID:${event.messageId} Error: ${e}`
        );
      }
    }
  } else {
    ctx.log.debug(
      `Event type ${event.type} is not in the list of event types to process. Message ID:${event.messageId}`
    );
  }
};

// function getIdentifiedFields(event: AnalyticsServerEvent, identifierFields: string[]): any | undefined {
//   const res = {};
//   let found = false;
//   for (const path of identifierFields) {
//     const f = get(event, path);
//     if (f && !(typeof f === "object" && Object.keys(f).length === 0)) {
//       found = true;
//       set(res, path, f);
//     }
//   }
//   if (!found) {
//     return undefined;
//   }
//   return res;
// }

export default UserRecognitionFunction;
