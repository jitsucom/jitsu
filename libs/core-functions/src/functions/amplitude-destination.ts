import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { randomUUID } from "crypto";
import { AmplitudeDestinationConfig } from "../meta";
import { requireDefined } from "juava";
import { eventTimeSafeMs, SystemContext } from "./lib";

const AmplitudeDestination: JitsuFunction<AnalyticsServerEvent, AmplitudeDestinationConfig> = async (
  event,
  { props, fetch, log, geo, ua, ...ctx }
) => {
  try {
    const deviceId = event.anonymousId;
    let sessionId: number | undefined = undefined;
    if (deviceId) {
      const systemContext = requireDefined((ctx as any as SystemContext).$system, `$system context is not available`);
      const ttlStore = systemContext.store;
      const ttlSec = 60 * (props.sessionWindow ?? 30);
      const sessionKey = `${ctx.source.id}_${deviceId}_sess`;
      const savedSessionValue = await ttlStore.getWithTTL(sessionKey);
      if (savedSessionValue) {
        sessionId = savedSessionValue.value;
        const ttl = savedSessionValue.ttl;
        log.debug(`Amplitude session found: ${sessionId} for deviceId: ${deviceId} ttl: ${ttl}`);
        if (ttl < ttlSec - 60) {
          // refresh ttl not often than once per minute
          await ttlStore.set(sessionKey, sessionId, { ttl: ttlSec });
        }
      } else {
        sessionId = new Date().getTime();
        log.debug(`Amplitude session not found for deviceId: ${deviceId} new session: ${sessionId}`);
        await ttlStore.set(sessionKey, sessionId, { ttl: ttlSec });
      }
    }
    const groupType = props.groupType || "group";
    const endpoint =
      props.dataResidency === "EU" ? "https://api.eu.amplitude.com/2/httpapi" : "https://api2.amplitude.com/2/httpapi";
    let payload: any = undefined;
    if (event.type === "identify" && event.userId) {
      payload = {
        api_key: props.key,
        events: [
          {
            time: eventTimeSafeMs(event),
            insert_id: event.messageId || randomUUID(),
            user_id: event.userId,
            event_type: "$identify",
            user_properties: {
              $set: {
                ...event.traits,
              },
            },
          },
        ],
      };
    } else if (event.type === "group" && props.enableGroupAnalytics && event.userId) {
      payload = {
        api_key: props.key,
        events: [
          {
            time: eventTimeSafeMs(event),
            insert_id: event.messageId || randomUUID(),
            user_id: event.userId,
            event_type: "$groupidentify",
            group_properties: {
              $set: {
                ...event.traits,
              },
            },
            groups: {
              [groupType]: event.groupId,
            },
          },
        ],
      };
    } else if (
      (event.type === "page" || event.type === "track") &&
      (event.userId || props.enableAnonymousUserProfiles)
    ) {
      let geoObj: any = {};
      if (geo) {
        geoObj = {
          country: geo.country?.code,
          region: geo.region?.code,
          city: geo.city?.name,
          dma: geo.location?.usaData ? geo.location.usaData.metroCode : undefined,
          location_lat: geo.location?.latitude,
          location_lng: geo.location?.longitude,
        };
      }
      let groups = {};
      if (event.context?.groupId && props.enableGroupAnalytics) {
        groups = { [groupType]: event.context?.groupId };
      }
      payload = {
        api_key: props.key,
        events: [
          {
            time: eventTimeSafeMs(event),
            insert_id: event.messageId || randomUUID(),
            event_type: event.type === "page" ? "pageview" : event.event || event.name || "Unknown Event",
            session_id: sessionId || -1,
            event_properties: event.properties,
            groups,
            user_properties: event.context?.traits,
            user_id: event.userId,
            device_id: deviceId ?? undefined,
            os_name: ua?.os?.name,
            os_version: ua?.os?.version,
            device_model: ua?.device?.model,
            device_manufacturer: ua?.device?.vendor,
            device_brand: ua?.device?.vendor,
            platform: ua?.device?.type,
            language: event.context?.locale,
            ip: event.context?.ip,
            user_agent: event.context?.userAgent,
            ...geoObj,
          },
        ],
      };
    }
    if (payload) {
      const res = await fetch(endpoint, {
        headers: {
          "Content-Type": "application/json",
          Accept: "*/*",
        },
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (res.status === 200) {
        log.debug(`Amplitude ${event.type} OK: ${res.status} message: ${await res.text()}`);
      } else {
        throw new Error(`Amplitude ${event.type} Error: ${res.status} message: ${await res.text()}`);
      }
    }
  } catch (e: any) {
    throw new RetryError(e.message);
  }
};

export default AmplitudeDestination;
