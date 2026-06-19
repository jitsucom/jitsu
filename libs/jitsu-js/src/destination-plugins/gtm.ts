import { loadScript } from "../script-loader";
import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";

export type GtmDestinationCredentials = {
  containerId?: string;
  dataLayerName?: string;
  // When false, Jitsu does not inject the GTM script — the client is expected to load
  // GTM itself (e.g. on page load). Jitsu still pushes events to the data layer.
  loadGtm?: boolean;
  // When true (default), Jitsu clears the data it pushed after each event so values from one
  // event don't leak into the next. Set to false to let values persist across events.
  resetDataLayer?: boolean;
} & CommonDestinationCredentials;

function omit(obj: any, ...keys: string[]) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

export const gtmPlugin: InternalPlugin<GtmDestinationCredentials> = {
  id: "gtm",
  async handle(config, payload: AnalyticsClientEvent) {
    const debug = !!config.debug;
    if (!applyFilters(payload, config)) {
      return;
    }
    await initGtmIfNeeded(config, payload);

    const dataLayer = window[config.dataLayerName || "dataLayer"];
    //traits could be in both nodes, context.traits takes precedence
    const traits = {
      ...(payload?.traits || {}),
      ...(payload?.context?.traits || {}),
    };
    //remove properties that defined separately
    const idsFromTraits = omit(traits, "id", "userId", "user_id", "anonymousId", "userId");
    if (debug) {
      console.debug("GTM plugin will be applied to following payload", payload);
    }

    // See  https://developers.google.com/tag-platform/tag-manager/server-side/common-event-data
    const userData = {
      email_address: traits.email,
    };
    const ids = {
      ...(payload.userId ? { user_id: payload.userId, userId: payload.userId } : {}),
      ...(payload.anonymousId ? { anonymousId: payload.anonymousId } : {}),
      ...idsFromTraits,
      user_data: Object.keys(userData).length > 0 ? userData : undefined,
    };
    if (debug) {
      console.debug("GTM plugin will set following user-related data layer vars", ids);
    }
    const pageProperties = payload.properties || {};
    const pageVariables = {
      page_location: pageProperties.url || payload.context?.page?.url,
      page_title: pageProperties.title || payload.context?.page?.title,
      page_path: pageProperties.path || payload.context?.page?.path,
      page_hash: pageProperties.hash || payload.context?.page?.hash,
      page_search: pageProperties.search || payload.context?.page?.search,
      page_referrer: payload?.context?.page?.referrer ?? "",
    };
    if (debug) {
      console.debug("GTM plugin will set following context (page) related data layer vars", ids);
    }
    // Keys Jitsu pushes for this event, so we can clear exactly them later.
    const pushedKeys = new Set<string>();
    const pushToDataLayer = (data: any) => {
      Object.keys(data).forEach(k => pushedKeys.add(k));
      dataLayer.push(data);
      if (debug) {
        console.debug("GTM plugin will push following data to dataLayer", data);
      }
    };
    switch (payload.type) {
      case "page":
        const { properties: pageProperties, context } = payload;
        const pageEvent = {
          event: "page_view",
          ...pageVariables,
          ...ids,
        };
        pushToDataLayer(pageEvent);
        break;
      case "track":
        const { properties: trackProperties } = payload;
        const trackEvent: any = {
          event: payload.event,
          ...pageVariables,
          ...trackProperties,
          ...ids,
        };
        pushToDataLayer(trackEvent);
        break;
      case "identify":
        const { traits } = payload;
        const identifyEvent: any = {
          event: "identify",
          ...pageVariables,
          ...traits,
          ...ids,
        };
        pushToDataLayer(identifyEvent);
        break;
    }
    // By default, clear the data Jitsu pushed so it doesn't accumulate across events. Skip this
    // entirely when resetDataLayer is disabled (the integrator wants values to persist).
    if (config.resetDataLayer !== false) {
      if (config.loadGtm === false) {
        // The client loads GTM itself and may keep its own data-layer values. Clear only the
        // keys Jitsu set this event and leave everything set outside Jitsu untouched. `event` is
        // omitted: it's already consumed by the trigger, and omitting it keeps this a data-only
        // push that won't fire event-based triggers.
        const cleared: Record<string, null> = {};
        pushedKeys.forEach(k => {
          if (k !== "event") {
            cleared[k] = null;
          }
        });
        if (Object.keys(cleared).length > 0) {
          dataLayer.push(cleared);
        }
      } else {
        // Jitsu loaded GTM itself, so it owns the data layer: reset the whole model between events.
        dataLayer.push(function (this: { reset: () => void }) {
          this.reset();
        });
      }
    }
  },
};

type GtmState = "fresh" | "loading" | "loaded" | "failed";

function getGtmState(): GtmState {
  return window["__jitsuGtmState"] || "fresh";
}

function setGtmState(s: GtmState) {
  window["__jitsuGtmState"] = s;
}

async function initGtmIfNeeded(config: GtmDestinationCredentials, payload: AnalyticsClientEvent) {
  const dlName = config.dataLayerName || "dataLayer";

  // The client loads GTM itself: don't inject the GTM script. We only make sure the data
  // layer exists so events can be pushed; the client-loaded GTM container will process them.
  if (config.loadGtm === false) {
    window[dlName] = window[dlName] || [];
    return;
  }

  if (getGtmState() !== "fresh") {
    return;
  }
  setGtmState("loading");

  const tagId = config.containerId;

  (function (w, l, i) {
    w[l] = w[l] || [];
    w[l].push({
      user_id: payload.userId,
    });
    w[l].push({
      "gtm.start": new Date().getTime(),
      event: "gtm.js",
    });
    const dl = l != "dataLayer" ? "&l=" + l : "";
    const scriptSrc = "googletagmanager.com/gtm";
    loadScript(scriptSrc, { www: true, js: true, query: "id=" + i + dl })
      .then(() => {
        setGtmState("loaded");
      })
      .catch(e => {
        console.warn(`GTM (containerId=${tagId}) init failed: ${e.message}`, e);
        setGtmState("failed");
      });
  })(window, dlName, tagId);
}
