import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { randomUUID } from "crypto";
import { AmplitudeDestinationConfig } from "../meta";
import { eventTimeSafeMs, getPageOrScreenProps } from "./lib";

const AmplitudeDestination: JitsuFunction<AnalyticsServerEvent, AmplitudeDestinationConfig> = async (
  event,
  { props, store, fetch, log, geo, ua, ...ctx }
) => {
  try {
    const deviceId = event.anonymousId;
    let sessionId: number | undefined = undefined;
    if (deviceId) {
      const ttlStore = store;
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
      (event.type === "page" || event.type === "track" || event.type === "screen") &&
      (event.userId || props.enableAnonymousUserProfiles)
    ) {
      const app = event.context?.app || ({} as any);
      const os = event.context?.os || ({} as any);
      const device = event.context?.device || ({} as any);

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
      let eventType: string = event.type;
      switch (event.type) {
        case "page":
          eventType = "pageview";
          break;
        case "track":
          eventType = event.event || "Unknown Event";
          break;
      }
      payload = {
        api_key: props.key,
        events: [
          {
            time: eventTimeSafeMs(event),
            insert_id: event.messageId || randomUUID(),
            event_type: eventType,
            session_id: sessionId || -1,
            event_properties: { ...getPageOrScreenProps(event), ...event.properties },
            groups,
            user_properties: event.context?.traits,
            user_id: event.userId,

            app_version: app.version,
            platform: os.name || ua?.device?.type,

            device_id: deviceId ?? undefined,
            os_name: os.name || ua?.os?.name,
            os_version: os.version || ua?.os?.version,
            device_model: device.model || ua?.device?.model,
            device_manufacturer: device.manufacturer || ua?.device?.vendor,
            device_brand: device.manufacturer || ua?.device?.vendor,

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
