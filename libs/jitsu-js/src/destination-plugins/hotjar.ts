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
  // When false, Jitsu does not inject the Hotjar tag - the page is expected to load it itself
  // (e.g. via its own snippet or a tag manager). Jitsu still forwards events to the existing
  // window.hj. The siteId is only used when Jitsu loads the tag. Default true.
  loadHotjar?: boolean;
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

// The siteId of the destination that actually loaded the tag. window.hj is a vendor-owned singleton,
// so only one site can be active per page; we track it to warn on misconfiguration.
function getHotjarSiteId(): string | undefined {
  return window["__jitsuHotjarSiteId"];
}

function setHotjarSiteId(id: string) {
  window["__jitsuHotjarSiteId"] = id;
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

    // Tag load failed: the stub has been swapped for a no-op and its queue dropped. Short-circuit so
    // we don't keep handing work to a dead instance.
    if (getHotjarState() === "failed") {
      return;
    }

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
    // window.hj is a singleton owned by the vendor script; a second destination pointing at a
    // different siteId can't get its own instance. Warn rather than silently routing events to the
    // wrong site - the first destination that loads the tag wins.
    const activeSiteId = getHotjarSiteId();
    if (config.loadHotjar !== false && activeSiteId && activeSiteId !== config.siteId) {
      console.warn(
        `Hotjar: a destination for siteId=${activeSiteId} is already active on this page; ` +
          `ignoring siteId=${config.siteId}. Multiple Hotjar destinations on one page are not supported.`
      );
    }
    return;
  }
  setHotjarState("loading");

  // Install the self-queuing stub (mirrors Hotjar's official snippet). Even when Jitsu does not
  // load the tag, this ensures events fired before the page's own Hotjar script runs are queued
  // and drained by it once it loads.
  window["hj"] =
    window["hj"] ||
    function () {
      (window["hj"].q = window["hj"].q || []).push(arguments);
    };

  if (config.loadHotjar !== false) {
    setHotjarSiteId(config.siteId);
    // Only set _hjSettings when we load the tag ourselves, so we never repoint a Hotjar tag the
    // page already configured.
    window["_hjSettings"] = { hjid: config.siteId, hjsv: HOTJAR_VERSION };

    loadScript(`static.hotjar.com/c/hotjar-${config.siteId}.js`, { query: `sv=${HOTJAR_VERSION}` })
      .then(() => {
        setHotjarState("loaded");
      })
      .catch(e => {
        console.warn(`Hotjar (siteId=${config.siteId}) init failed: ${e.message}`, e);
        setHotjarState("failed");
        // Init failed: replace the queuing stub with a no-op and drop its queue so events fired for
        // the rest of the page lifetime don't accumulate in window.hj.q.
        window["hj"] = function () {};
      });
  } else {
    // The page loads the Hotjar tag itself; we only forward events to it.
    setHotjarState("loaded");
  }
}
