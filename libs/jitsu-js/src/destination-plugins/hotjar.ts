import { loadScript } from "../script-loader";
import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";

export type HotjarDestinationCredentials = {
  // Hotjar Site ID (a.k.a. hjid).
  siteId: string;
  // When true, Jitsu `page` events emit a Hotjar virtual page view via hj('stateChange', path).
  // Off by default to avoid double-counting Hotjar's built-in page detection.
  spaPageViews?: boolean;
  // What to do with `track` event properties. Hotjar has no per-event property API - the only way
  // to attach arbitrary data is hj('identify', userId, attributes). "attributes" merges the
  // properties into the identified user's record (requires a userId); "ignore" (default) drops them.
  trackProperties?: "ignore" | "attributes";
} & CommonDestinationCredentials;

// Hotjar protocol version. The tag URL and _hjSettings must agree on this.
const HOTJAR_VERSION = 6;

type HotjarState = "fresh" | "loading" | "loaded" | "failed";

function getHotjarState(): HotjarState {
  return window["__jitsuHotjarState"] || "fresh";
}

function setHotjarState(s: HotjarState) {
  window["__jitsuHotjarState"] = s;
}

// Hotjar event names must be <=250 chars and use no spaces.
// https://help.hotjar.com/hc/en-us/articles/4405109971095
function sanitizeEventName(event: string): string {
  return event.substring(0, 250).replace(/ /g, "_");
}

export const hotjarPlugin: InternalPlugin<HotjarDestinationCredentials> = {
  id: "hotjar",
  async handle(config, payload: AnalyticsClientEvent) {
    if (!applyFilters(payload, config)) {
      return;
    }
    initHotjarIfNeeded(config);

    // The vendor snippet installs a self-queuing stub, so calls made before the script finishes
    // loading are queued by Hotjar itself - no need for our own flush queue.
    const hj = window["hj"];
    if (typeof hj !== "function") {
      return;
    }

    // traits could be in both nodes, context.traits takes precedence
    const traits = {
      ...(payload.traits || {}),
      ...(payload.context?.traits || {}),
    };

    switch (payload.type) {
      case "identify": {
        // Hotjar accepts a null userId to attach anonymous attributes.
        hj("identify", payload.userId ?? null, traits);
        break;
      }
      case "track": {
        if (payload.event) {
          hj("event", sanitizeEventName(payload.event));
        }
        if (config.trackProperties === "attributes" && payload.userId && payload.properties) {
          hj("identify", payload.userId, payload.properties);
        }
        break;
      }
      case "page": {
        if (config.spaPageViews) {
          const path = payload.properties?.path || payload.properties?.url || payload.context?.page?.path;
          if (path) {
            hj("stateChange", path);
          }
        }
        break;
      }
    }
  },
};

function initHotjarIfNeeded(config: HotjarDestinationCredentials) {
  if (getHotjarState() !== "fresh") {
    return;
  }
  setHotjarState("loading");

  // Install the self-queuing stub (mirrors Hotjar's official snippet).
  window["hj"] =
    window["hj"] ||
    function () {
      (window["hj"].q = window["hj"].q || []).push(arguments);
    };
  window["_hjSettings"] = { hjid: config.siteId, hjsv: HOTJAR_VERSION };

  loadScript(`static.hotjar.com/c/hotjar-${config.siteId}.js`, { query: `sv=${HOTJAR_VERSION}` })
    .then(() => {
      setHotjarState("loaded");
    })
    .catch(e => {
      console.warn(`Hotjar (siteId=${config.siteId}) init failed: ${e.message}`, e);
      setHotjarState("failed");
    });
}
