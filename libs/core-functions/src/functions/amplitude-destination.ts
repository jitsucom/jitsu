import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { randomUUID } from "crypto";
import { parseUserAgent } from "./lib/browser";
import { AmplitudeDestinationConfig } from "../meta";
import dayjs from "dayjs";

const AmplitudeDestination: JitsuFunction<AnalyticsServerEvent, AmplitudeDestinationConfig> = async (
  event,
  { props, fetch, log, geo, destination }
) => {
  try {
    const groupType = props.groupType || "group";
    const deviceId = event.anonymousId;
    const endpoint =
      props.dataResidency === "EU" ? "https://api.eu.amplitude.com/2/httpapi" : "https://api2.amplitude.com/2/httpapi";
    let payload: any = undefined;
    if (event.type === "identify") {
      payload = {
        api_key: props.key,
        events: [
          {
            time: dayjs(event.timestamp).valueOf(),
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
    } else if (event.type === "group" && props.enableGroupAnalytics) {
      payload = {
        api_key: props.key,
        events: [
          {
            time: dayjs(event.timestamp).valueOf(),
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
      const browser = event.context?.userAgent
        ? parseUserAgent(event.context?.userAgent, event.context?.userAgentVendor)
        : undefined;
      let groups = {};
      if (event.context?.groupId && props.enableGroupAnalytics) {
        groups = { [groupType]: event.context?.groupId };
      }
      payload = {
        api_key: props.key,
        events: [
          {
            time: dayjs(event.timestamp).valueOf(),
            insert_id: event.messageId || randomUUID(),
            event_type: event.type === "page" ? "pageview" : event.event || event.name || "Unknown Event",
            event_properties: event.properties,
            groups,
            user_properties: event.context?.traits,
            user_id: event.userId,
            device_id: deviceId ?? undefined,
            os_name: browser?.os,
            language: event.context?.locale,
            ip: event.request_ip,
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
        log.info(`Amplitude ${event.type} OK: ${res.status} message: ${await res.text()}`);
      } else {
        throw new Error(`Amplitude ${event.type} Error: ${res.status} message: ${await res.text()}`);
      }
    }
  } catch (e: any) {
    throw new RetryError(e.message);
  }
};

export default AmplitudeDestination;
