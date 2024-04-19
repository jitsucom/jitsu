import { loadScript } from "../script-loader";
import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";

export type GtmDestinationCredentials = {
  containerId?: string;
  dataLayerName?: string;
} & CommonDestinationCredentials;

function omit(obj: any, ...keys: string[]) {
  const set = new Set(keys);
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !set.has(k)));
}

export const gtmPlugin: InternalPlugin<GtmDestinationCredentials> = {
  id: "gtm",
  async handle(config, payload: AnalyticsClientEvent) {
    if (!applyFilters(payload, config)) {
      return;
    }
    await initGtmIfNeeded(config, payload);

    const dataLayer = window[config.dataLayerName || "dataLayer"];
    const idsFromTraits = payload.traits ? omit(payload.traits, "id", "userId", "user_id", "anonymousId", "userId") : {};
    console.log("idsFromTraits", idsFromTraits, payload.traits);
    const ids = {
      ...(payload.userId ? { user_id: payload.userId, userId: payload.userId } : {}),
      ...(payload.anonymousId ? { anonymousId: payload.anonymousId } : {}),
      ...idsFromTraits,
    };
    switch (payload.type) {
      case "page":
        const { properties: pageProperties, context } = payload;
        const pageEvent = {
          event: "page_view",
          page_location: pageProperties.url,
          page_title: pageProperties.title,
          page_path: pageProperties.path,
          page_hash: pageProperties.hash,
          page_search: pageProperties.search,
          page_referrer: context?.page?.referrer ?? "",
          ...ids,
        };
        dataLayer.push(pageEvent);
        break;
      case "track":
        const { properties: trackProperties } = payload;
        const trackEvent: any = {
          event: payload.event,
          ...trackProperties,
          ...ids,
        };
        dataLayer.push(trackEvent);
        break;
      case "identify":
        const { traits } = payload;
        const identifyEvent: any = {
          event: "identify",
          ...traits,
          ...ids,
        };
        dataLayer.push(identifyEvent);
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
