import { JitsuFunction } from "@jitsu/protocols/functions";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { getEventCustomProperties } from "./lib";
import { parseUserAgent } from "./lib/browser";
import { init, track, flush, identify, Identify, groupIdentify } from "@amplitude/analytics-node";
import { AmplitudeDestinationConfig } from "../meta";

function getHostFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname;
  } catch (e) {
    return undefined;
  }
}

function getPathFromUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).pathname;
  } catch (e) {
    return undefined;
  }
}

function getEventProperties(event: AnalyticsServerEvent) {
  //see https://github.com/PostHog/posthog-js-lite/blob/master/posthog-web/src/context.ts
  const browser = event.context?.userAgent
    ? parseUserAgent(event.context?.userAgent, event.context?.userAgentVendor)
    : undefined;
  return {
    referrer: event.context?.page?.referrer,
    referring_domain: event.context?.page?.referring_domain || getHostFromUrl(event.context?.page?.referrer),
    url: event.context?.page?.url,
    host: event.context?.page?.host || getHostFromUrl(event.context?.page?.url),
    pathname: event.context?.page?.path || getPathFromUrl(event.context?.page?.url),

    browser: browser?.name,
    device: browser?.deviceType,
    os: browser?.os,
    browser_version: browser?.browserVersion,

    //implement when it's implemented on a client, doesn't seem like a very important data points
    screen_dpi: event.context?.screen?.density,
    screen_height: event.context?.screen?.height,
    screen_width: event.context?.screen?.width,
    ...getEventCustomProperties(event, {
      exclude: obj => {
        delete obj.traits;
        delete obj.referer;
        delete obj.groupId;
        delete obj.referring_domain;
        delete obj.url;
        delete obj.host;
        delete obj.path;
        delete obj.screen;
        delete obj.page;
        delete obj.width;
        delete obj.height;
      },
    }),
  };
}

const AmplitudeDestination: JitsuFunction<AnalyticsServerEvent, AmplitudeDestinationConfig> = async (
  event,
  { props, fetch, log, geo }
) => {
  const groupType = props.groupType || "group";
  const deviceId = event.anonymousId;
  await init(props.key, {
    logLevel: 0,
    serverZone: props.dataResidency,
  }).promise;
  if (event.type === "identify") {
    const identifyObj = new Identify();
    for (const [key, value] of Object.entries(event.traits || {})) {
      if (value) {
        identifyObj.set(key, `${value}`);
      }
    }
    identify(identifyObj, {
      user_id: event.userId,
    }).promise.then(res => {
      if (res.code === 200) {
        log.info(`Amplitude identify OK: ${res.code} message: ${res.message}`);
      } else {
        log.error(`Amplitude identify Error: ${res.code} message: ${res.message}`);
      }
    });
  } else if (event.type === "group" && props.enableGroupAnalytics) {
    const identifyObj = new Identify();
    for (const [key, value] of Object.entries(event.traits || {})) {
      if (value) {
        identifyObj.set(key, `${value}`);
      }
    }
    groupIdentify(groupType, event.groupId ?? "", identifyObj, {
      user_id: event.userId,
    }).promise.then(res => {
      if (res.code === 200) {
        log.info(`Amplitude groupIdentify OK: ${res.code} message: ${res.message}`);
      } else {
        log.error(`Amplitude groupIdentify Error: ${res.code} message: ${res.message}`);
      }
    });
  } else if (event.type === "page" || event.type === "track") {
    const userId = event.userId;
    if (userId || props.enableAnonymousUserProfiles) {
      const eventName = event.type === "page" ? "pageview" : event.event || event.name || "Unknown Event";
      let groups = {};
      if (event.context?.groupId && props.enableGroupAnalytics) {
        groups = { [groupType]: event.context?.groupId };
      }
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
      track(
        {
          event_type: eventName,
          event_properties: event.properties,
          groups,
          user_properties: event.context?.traits,
        },
        undefined,
        {
          user_id: userId,
          device_id: deviceId ?? undefined,
          os_name: browser?.os,
          language: event.context?.locale,
          ip: event.request_ip,
          insert_id: event.messageId,
          user_agent: event.context?.userAgent,
          ...geoObj,
        }
      ).promise.then(res => {
        if (res.code === 200) {
          log.info(`Amplitude track OK: ${res.code} message: ${res.message}`);
        } else {
          log.error(`Amplitude track Error: ${res.code} message: ${res.message}`);
        }
      });
    }
  }
  await flush().promise;
};

export default AmplitudeDestination;
