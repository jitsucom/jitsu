import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { PostHog } from "posthog-node";
import { eventTimeSafeMs, getEventCustomProperties } from "./lib";
import { parseUserAgentLegacy } from "./lib/browser";
import { POSTHOG_DEFAULT_HOST, PosthogDestinationConfig } from "../meta";

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
  const analyticsContext = event.context || {};
  const page = analyticsContext.page || {};
  const browser = analyticsContext.userAgent
    ? parseUserAgentLegacy(analyticsContext.userAgent, analyticsContext.userAgentVendor)
    : ({} as any);
  const geo = analyticsContext.geo || {};
  return {
    $referrer: page.referrer,
    $referring_domain: page.referring_domain || getHostFromUrl(page.referrer),
    $current_url: page.url,
    $host: page.host || getHostFromUrl(page.url),
    $pathname: page.path || getPathFromUrl(page.url),
    ...(event.type === "screen" ? { $screen_name: event.name } : {}),

    $browser: browser.name,
    $device: analyticsContext.device?.type || browser.deviceType,
    $os: browser.os,
    $browser_version: browser.browserVersion,

    $geoip_city_name: geo.city?.name,
    $geoip_country_name: geo.country?.name,
    $geoip_country_code: geo.country?.code,
    $geoip_continent_code: geo.continent?.code,
    $geoip_postal_code: geo.postalCode,
    $geoip_time_zone: geo.location?.timezone,

    //implement when it's implemented on a client, doesn't seem like a very important data points
    $screen_dpi: analyticsContext.screen?.density,
    $screen_height: analyticsContext.screen?.height,
    $screen_width: analyticsContext.screen?.width,

    ...getEventCustomProperties(event, {
      exclude: obj => {
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

const PosthogDestination: JitsuFunction<AnalyticsServerEvent, PosthogDestinationConfig> = async (
  event,
  { props, fetch, log }
) => {
  // compatibility with configs that were created before this separate setting was introduced
  const sendAnonymousEvents =
    typeof props.sendAnonymousEvents !== "undefined" ? props.sendAnonymousEvents : props.enableAnonymousUserProfiles;
  const groupType = props.groupType || "group";
  const client = new PostHog(props.key, { host: props.host || POSTHOG_DEFAULT_HOST, fetch: fetch });
  try {
    if (event.type === "identify") {
      client.identify({
        distinctId: event.userId as string,
        properties: { $anon_distinct_id: event.anonymousId || undefined, ...event.traits },
      });

      /**
       * If we've been tracking anonymous events under user/"Person" profiles
       * in Posthog, we should merge the anonymous person with the identified
       * one, so that the entire user event history is consolidated.
       */
      const alias: string | undefined = event.anonymousId || (event.traits?.email as string);
      if (sendAnonymousEvents && alias) {
        client.alias({
          distinctId: event.userId as string,
          alias: alias,
        });
      }
    } else if (event.type === "group" && props.enableGroupAnalytics) {
      client.groupIdentify({
        groupType: groupType,
        groupKey: event.groupId as string,
        properties: event.traits,
      });
    } else if (event.type === "track") {
      let groups = {};
      if (event.context?.groupId && props.enableGroupAnalytics) {
        groups = { groups: { [groupType]: event.context?.groupId } };
      }
      const distinctId = event.userId || event.anonymousId || (event.traits?.email as string);
      if (!distinctId) {
        log.info(`No distinct id found for event ${JSON.stringify(event)}`);
      } else {
        if (event.userId || sendAnonymousEvents) {
          client.capture({
            distinctId: distinctId as string,
            event: event.event || event.name || "Unknown Event",
            timestamp: new Date(eventTimeSafeMs(event)),
            properties: {
              ...getEventProperties(event),
              // https://posthog.com/docs/getting-started/person-properties
              $process_person_profile: props.enableAnonymousUserProfiles || !!event.userId,
            },
            ...groups,
          });
        }
      }
    } else if (event.type === "page" || event.type === "screen") {
      let groups = {};
      if (event.context?.groupId && props.enableGroupAnalytics) {
        groups = { groups: { [groupType]: event.context?.groupId } };
      }
      const distinctId = event.userId || event.anonymousId || (event.traits?.email as string);
      if (!distinctId) {
        log.info(
          `No distinct id found for ${event.type === "page" ? "Page View" : "Screen"} event ${JSON.stringify(event)}`
        );
      } else {
        if (event.userId || sendAnonymousEvents) {
          client.capture({
            distinctId: distinctId as string,
            event: event.type === "page" ? "$pageview" : "$screen",
            timestamp: new Date(eventTimeSafeMs(event)),
            properties: {
              ...getEventProperties(event),
              // https://posthog.com/docs/getting-started/person-properties
              $process_person_profile: props.enableAnonymousUserProfiles || !!event.userId,
            },
            ...groups,
          });
        }
      }
    }
  } catch (e: any) {
    throw new RetryError(e.message);
  } finally {
    await client.shutdown();
  }
};

export default PosthogDestination;
