import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { PostHog } from "posthog-node";
import { eventTimeSafeMs, getEventCustomProperties, parseUserAgentLegacy } from "@jitsu/core-functions-lib";
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
  // posthog-node 5.x treats responses as WHATWG fetch Responses - notably it calls
  // response.body?.cancel() to discard unread bodies. The functions fetch returns a
  // node-fetch-style response whose body is a Node Readable (destroy(), no cancel()),
  // which fails every delivery with "response.body?.cancel is not a function". Adapt
  // to the surface posthog actually consumes (PostHogFetchResponse: status, headers.get,
  // text, json) and expose no body, so the optional-chained cancel() no-ops.
  const posthogFetch = async (url: string, options: any) => {
    const res = await fetch(url, options);
    return {
      status: res.status,
      headers: { get: (name: string) => res.headers?.get?.(name) ?? null },
      text: () => res.text(),
      json: () => res.json(),
    };
  };
  const client = new PostHog(props.key, {
    host: props.host || POSTHOG_DEFAULT_HOST,
    fetch: posthogFetch,
    // posthog-node 5.x gzips request bodies by default; these per-event batches
    // are tiny, and uncompressed bodies keep the functions fetch-debug log readable
    disableCompression: true,
  });
  // capture()/identify()/alias()/groupIdentify() only enqueue - the actual HTTP
  // delivery happens inside shutdown(), and posthog-node swallows fetch errors
  // there (they are emitted on the "error" event instead of rejecting the
  // shutdown promise). Without listening for them, a failed delivery would be
  // reported as success and the events silently dropped.
  let deliveryError: any = undefined;
  client.on("error", e => (deliveryError = deliveryError ?? e));
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
    // synchronous enqueue-time errors; the finally below still flushes the queue
    throw new RetryError(e?.message || String(e));
  } finally {
    // This is where the queued events are actually sent. Flush explicitly first:
    // flush() rejects with the delivery error without logging anything, while
    // shutdown()'s internal flush console.error's every failure with the full
    // response body ("Error while flushing PostHog: ...") - and that call is
    // hardwired to console, so no client option can silence it. After flush()
    // the queue is empty (posthog drops the batch on HTTP errors), leaving
    // shutdown() nothing to re-send; it still runs to release timers and
    // pending work.
    await client.flush().catch(e => (deliveryError = deliveryError ?? e));
    await client.shutdown().catch(e => (deliveryError = deliveryError ?? e));
  }
  if (deliveryError) {
    throw new RetryError(deliveryError?.message || String(deliveryError));
  }
};

export default PosthogDestination;
