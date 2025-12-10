import { JitsuFunction } from "@jitsu/protocols/functions";
import { RetryError } from "@jitsu/functions-lib";
import type { AnalyticsServerEvent } from "@jitsu/protocols/analytics";
import { StatsigDestinationConfig } from "../meta";
import { eventTimeSafeMs, getPageOrScreenProps } from "@jitsu/core-functions-lib";
import omit from "lodash/omit";

const STATSIG_API_ENDPOINT = "https://events.statsigapi.net/v1/log_event";

/**
 * Flattens a nested object into a flat object with dot notation keys
 * Example: { user: { name: "John" } } => { "user.name": "John" }
 */
function flattenObject(obj: any, prefix: string = ""): Record<string, string> {
  const flattened: Record<string, string> = {};

  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;

    const value = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      continue;
    } else if (typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      // Recursively flatten nested objects
      Object.assign(flattened, flattenObject(value, newKey));
    } else if (Array.isArray(value)) {
      // Convert arrays to JSON string
      flattened[newKey] = JSON.stringify(value);
    } else if (value instanceof Date) {
      // Convert dates to ISO string
      flattened[newKey] = value.toISOString();
    } else {
      // Convert primitives to strings
      flattened[newKey] = String(value);
    }
  }

  return flattened;
}

/**
 * Parses Segment-style array format where even indices are keys and odd indices are values
 * Example: ["key1", "value1", "key2", "value2"] => { key1: "value1", key2: "value2" }
 */
function parseSegmentArray(arr: any): Record<string, any> {
  const result: Record<string, string> = {};

  if (!Array.isArray(arr)) {
    return result;
  }

  for (let i = 0; i < arr.length - 1; i += 2) {
    const key = arr[i];
    const value = arr[i + 1];

    if (key !== null && key !== undefined && value !== null && value !== undefined) {
      result[String(key)] = value;
    }
  }

  return result;
}

/**
 * Filters out Statsig-specific properties that should not be included in metadata
 */
function filterStatsigProperties(properties: any): any {
  if (!properties || typeof properties !== "object") {
    return properties;
  }

  const filtered = { ...properties };
  delete filtered.statsigCustomIDs;
  delete filtered.statsigCustom;
  delete filtered.statsigEnvironment;
  return filtered;
}

/**
 * Extracts context properties for inclusion in metadata
 */
function getContextMetadata(type: string, context: any): Record<string, any> {
  if (!context || typeof context !== "object") {
    return {};
  }
  const omitProperties = ["traits", "clientIds", "groupId", "ip"];
  if (type === "page") {
    omitProperties.push("page");
  }

  return omit(context, ...omitProperties);
}

/**
 * Builds and flattens metadata object, optionally including context
 */
function buildMetadata(
  type: string,
  baseMetadata: Record<string, any>,
  context: any,
  includeContext: boolean,
  segmentCompatibility: boolean
): Record<string, string> {
  const metadataObj = { ...baseMetadata };

  // Add context if enabled (and not in segment compatibility mode)
  if (!segmentCompatibility && includeContext) {
    const contextMetadata = getContextMetadata(type, context);
    Object.assign(metadataObj, contextMetadata);
  }

  return flattenObject(metadataObj);
}

const StatsigDestination: JitsuFunction<AnalyticsServerEvent, StatsigDestinationConfig> = async (event, ctx) => {
  const { props, fetch, log } = ctx;

  // Skip anonymous events if not enabled
  if (!event.userId && !props.enableAnonymousUserProfiles) {
    log.debug("Skipping anonymous event - enableAnonymousUserProfiles is disabled");
    return;
  }

  // Build Statsig user object
  const user: any = {};

  if (event.userId) {
    user.userID = String(event.userId);
  }

  // Build customIDs based on compatibility mode
  const customIDs: Record<string, string> = {};
  const traits = event.type === "identify" ? event.traits : event.context?.traits;

  if (props.segmentCompatibility) {
    // Segment Compatibility Mode: use statsigCustomIDs from properties or traits
    const statsigCustomIDsArray = (event.properties as any)?.statsigCustomIDs || (traits as any)?.statsigCustomIDs;

    // Parse Segment-style array format: ["key1", "value1", "key2", "value2"]
    if (statsigCustomIDsArray) {
      const parsedCustomIDs = parseSegmentArray(statsigCustomIDsArray);
      Object.assign(customIDs, parsedCustomIDs);
    }
  } else {
    // Default Mode: auto-populate customIDs from various sources
    if (event.anonymousId) {
      customIDs.jitsuAnonymousId = String(event.anonymousId);
    }

    // Add groupId to customIDs
    const groupId = event.groupId || event.context?.groupId;
    if (groupId) {
      customIDs.groupId = String(groupId);
    }

    // Add Google Analytics 4 Client ID
    if (event.context?.clientIds?.ga4?.clientId) {
      customIDs.ga4ClientId = event.context.clientIds.ga4.clientId;
    }

    // Add Firebase App Instance ID
    if (event.context?.clientIds?.firebase?.appInstanceId) {
      customIDs.firebaseAppInstanceId = event.context.clientIds.firebase.appInstanceId;
    }

    // Add Facebook IDs
    if (event.context?.clientIds?.fbc) {
      customIDs.fbc = event.context.clientIds.fbc;
    }
    if (event.context?.clientIds?.fbp) {
      customIDs.fbp = event.context.clientIds.fbp;
    }
  }

  // Set customIDs if any exist
  if (Object.keys(customIDs).length > 0) {
    user.customIDs = customIDs;
  }

  // Add country from geo data
  if (event.context?.geo?.country?.code) {
    user.country = event.context.geo.country.code;
  }

  // Add Statsig environment - properties/traits take precedence over config
  const statsigEnvironmentFromEvent =
    (event.properties as any)?.statsigEnvironment || (traits as any)?.statsigEnvironment;

  if (statsigEnvironmentFromEvent) {
    // Use statsigEnvironment from properties or traits
    if (typeof statsigEnvironmentFromEvent === "object") {
      user.statsigEnvironment = statsigEnvironmentFromEvent;
    } else if (typeof statsigEnvironmentFromEvent === "string") {
      // Support simple string format
      user.statsigEnvironment = {
        tier: statsigEnvironmentFromEvent,
      };
    }
  } else if (props.environment) {
    // Fall back to config environment
    user.statsigEnvironment = {
      tier: props.environment,
    };
  }

  // Add standard user properties
  if (event.context?.ip) {
    user.ip = event.context.ip;
  }
  if (event.context?.userAgent) {
    user.userAgent = event.context.userAgent;
  }
  if (event.context?.locale) {
    user.locale = event.context.locale;
  }
  if (event.context?.app?.version) {
    user.appVersion = event.context.app.version;
  }

  // Add custom properties based on compatibility mode
  if (props.segmentCompatibility) {
    // Segment Compatibility Mode: use statsigCustom from properties or traits
    const statsigCustomArray = (event.properties as any)?.statsigCustom || (traits as any)?.statsigCustom;

    // Parse Segment-style array format: ["key1", "value1", "key2", "value2"]
    if (statsigCustomArray) {
      const parsedCustom = parseSegmentArray(statsigCustomArray);
      if (Object.keys(parsedCustom).length > 0) {
        user.custom = flattenObject(parsedCustom);
      }
    }
  } else {
    // Default Mode: flatten traits, excluding email which is in privateAttributes
    if (traits) {
      const customTraits = { ...traits };
      delete customTraits.email; // Remove email as it's in privateAttributes
      if (Object.keys(customTraits).length > 0) {
        user.custom = flattenObject(customTraits);
      }
    }
  }

  const events: any[] = [];
  const timestamp = eventTimeSafeMs(event);

  try {
    switch (event.type) {
      case "track": {
        const eventName = event.event || "Unknown Event";
        const filteredProperties = filterStatsigProperties(event.properties);
        const metadata = buildMetadata(
          event.type,
          filteredProperties || {},
          event.context,
          props.includeContextInMetadata || false,
          props.segmentCompatibility || false
        );

        events.push({
          user,
          eventName,
          time: timestamp,
          value: event.properties?.value,
          metadata,
        });
        break;
      }

      case "page": {
        if (props.sendPageEvents) {
          const filteredProperties = filterStatsigProperties(event.properties);
          const baseMetadata = {
            ...getPageOrScreenProps(event),
            ...filteredProperties,
          };
          const metadata = buildMetadata(
            event.type,
            baseMetadata,
            event.context,
            props.includeContextInMetadata || false,
            props.segmentCompatibility || false
          );

          events.push({
            user,
            eventName: "page_view",
            time: timestamp,
            metadata,
          });
        }
        break;
      }

      case "screen": {
        if (props.sendPageEvents) {
          const filteredProperties = filterStatsigProperties(event.properties);
          const baseMetadata = {
            ...getPageOrScreenProps(event),
            ...filteredProperties,
          };
          const metadata = buildMetadata(
            event.type,
            baseMetadata,
            event.context,
            props.includeContextInMetadata || false,
            props.segmentCompatibility || false
          );

          events.push({
            user,
            eventName: "screen_view",
            time: timestamp,
            metadata,
          });
        }
        break;
      }

      case "identify": {
        const metadata = buildMetadata(
          event.type,
          {},
          event.context,
          props.includeContextInMetadata || false,
          props.segmentCompatibility || false
        );

        events.push({
          user,
          eventName: "identify",
          time: timestamp,
          metadata,
        });
        break;
      }

      case "group": {
        const filteredTraits = filterStatsigProperties(event.traits);
        const baseMetadata = {
          groupId: event.groupId,
          ...filteredTraits,
        };
        const metadata = buildMetadata(
          event.type,
          baseMetadata,
          event.context,
          props.includeContextInMetadata || false,
          props.segmentCompatibility || false
        );

        events.push({
          user,
          eventName: "group",
          time: timestamp,
          value: event.groupId,
          metadata,
        });
        break;
      }

      default:
        log.warn(`Unknown event type: ${event.type}`);
        return;
    }

    if (events.length === 0) {
      log.debug("No events to send to Statsig");
      return;
    }

    const payload = {
      events,
    };

    const res = await fetch(STATSIG_API_ENDPOINT, {
      method: "POST",
      headers: {
        "statsig-api-key": props.apiKey,
        "Content-Type": "application/json",
        "STATSIG-CLIENT-TIME": String(Date.now()),
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 200 || res.status === 202) {
      log.debug(`Statsig ${event.type} event sent successfully: ${res.status}`);
    } else {
      const responseText = await res.text();
      throw new Error(`Statsig ${event.type} Error: ${res.status} message: ${responseText}`);
    }
  } catch (e: any) {
    throw new RetryError(e.message);
  }
};

StatsigDestination.displayName = "statsig-destination";

StatsigDestination.description = "Send events to Statsig for feature flags, experimentation, and product analytics";

export default StatsigDestination;
