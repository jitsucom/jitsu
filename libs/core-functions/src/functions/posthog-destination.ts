import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { PostHog } from "posthog-node";
import { getEventCustomProperties } from "./lib";
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
  const browser = event.context?.userAgent
    ? parseUserAgentLegacy(event.context?.userAgent, event.context?.userAgentVendor)
    : undefined;
  const geo = event.context?.geo || {};
  return {
    $referrer: event.context?.page?.referrer,
    $referring_domain: event.context?.page?.referring_domain || getHostFromUrl(event.context?.page?.referrer),
    $current_url: event.context?.page?.url,
    $host: event.context?.page?.host || getHostFromUrl(event.context?.page?.url),
    $pathname: event.context?.page?.path || getPathFromUrl(event.context?.page?.url),

    $browser: browser?.name,
    $device: browser?.deviceType,
    $os: browser?.os,
    $browser_version: browser?.browserVersion,

    $geoip_city_name: geo.city?.name,
    $geoip_country_name: geo.country?.name,
    $geoip_country_code: geo.country?.code,
    $geoip_continent_code: geo.continent?.code,
    $geoip_postal_code: geo.postalCode,
    $geoip_time_zone: geo.location?.timezone,

    //implement when it's implemented on a client, doesn't seem like a very important data points
    $screen_dpi: event.context?.screen?.density,
    $screen_height: event.context?.screen?.height,
    $screen_width: event.context?.screen?.width,
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
  const groupType = props.groupType || "group";
  const client = new PostHog(props.key, { host: props.host || POSTHOG_DEFAULT_HOST, fetch: fetch });
  try {
    if (event.type === "identify") {
      if (!event.userId) {
        const distinctId = event.anonymousId || event.traits?.email;
        if (!distinctId) {
          log.info(`No distinct id found for event ${JSON.stringify(event)}`);
        } else if (props.enableAnonymousUserProfiles) {
          client.identify({
            distinctId: distinctId as string,
            properties: { $anon_distinct_id: event.anonymousId || undefined, ...event.traits },
          });
        }
      } else {
        if (props.enableAnonymousUserProfiles) {
          if (event.anonymousId || event.traits?.email) {
            client.alias({
              distinctId: (event.anonymousId || event.traits?.email) as string,
              alias: event.userId as string,
            });
          }
        }
        client.identify({
          distinctId: event.userId as string,
          properties: { $anon_distinct_id: event.anonymousId || undefined, ...event.traits },
        });
      }
      // if (props.sendIdentifyEvents) {
      //   const distinctId = event.userId || (event.traits?.email as string) || event.anonymousId;
      //   // if (distinctId) {
      //   //   client.capture({
      //   //     distinctId: distinctId as string,
      //   //     event: "Identify",
      //   //     properties: getEventProperties(event),
      //   //   });
      //   // }
      // }
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
        if (event.userId || props.enableAnonymousUserProfiles) {
          client.capture({
            distinctId: distinctId as string,
            event: event.event || event.name || "Unknown Event",
            properties: getEventProperties(event),
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
        if (event.userId || props.enableAnonymousUserProfiles) {
          client.capture({
            distinctId: distinctId as string,
            event: event.type === "page" ? "$pageview" : "$screen",
            properties: getEventProperties(event),
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
