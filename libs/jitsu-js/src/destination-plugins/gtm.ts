import { loadScript } from "../script-loader";
import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";

export type GtmDestinationCredentials = {
  containerId?: string;
  dataLayerName?: string;
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
    const pushToDataLayer = (data: any) => {
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
    dataLayer.push(function () {
      this.reset();
    });
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
  if (getGtmState() !== "fresh") {
    return;
  }
  setGtmState("loading");

  const dlName = config.dataLayerName || "dataLayer";
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
    const scriptSrc = "https://www.googletagmanager.com/gtm.js?id=" + i + dl;
    loadScript(scriptSrc)
      .then(() => {
        setGtmState("loaded");
      })
      .catch(e => {
        console.warn(`GTM (containerId=${tagId}) init failed: ${e.message}`, e);
        setGtmState("failed");
      });
  })(window, dlName, tagId);
}
