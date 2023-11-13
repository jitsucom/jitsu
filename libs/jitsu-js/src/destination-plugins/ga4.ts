import { loadScript } from "../script-loader";
import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";

const defaultScriptSrc = "https://www.googletagmanager.com/gtag/js";

export type Ga4DestinationCredentials = {
  debug?: boolean;
  measurementIds?: string;
  autoPageView?: boolean;
  dataLayerName?: string;
} & CommonDestinationCredentials;

export const ga4Plugin: InternalPlugin<Ga4DestinationCredentials> = {
  id: "ga4-tag",
  async handle(config, payload: AnalyticsClientEvent) {
    if (!applyFilters(payload, config)) {
      return;
    }
    await initGa4IfNeeded(config, payload);

    const dataLayer = window[config.dataLayerName || "dataLayer"];
    const gtag = function () {
      dataLayer.push(arguments);
    };
    const ids = {
      ...(payload.userId ? { user_id: payload.userId, userId: payload.userId } : {}),
      ...(payload.anonymousId ? { anonymousId: payload.anonymousId } : {}),
    };
    if (payload.userId) {
      // @ts-ignore
      gtag("set", { user_id: payload.userId });
    }

    switch (payload.type) {
      case "page":
        if (config.autoPageView) {
          console.log("autoPageView");
          break;
        }
        const { properties: pageProperties, context } = payload;
        const pageEvent = {
          page_location: pageProperties.url,
          page_title: pageProperties.title,
          page_path: pageProperties.path,
          page_hash: pageProperties.hash,
          page_search: pageProperties.search,
          page_referrer: context?.page?.referrer ?? "",
          ...ids,
        };
        // @ts-ignore
        gtag("event", "page_view", pageEvent);
        break;
      case "track":
        const { properties: trackProperties } = payload;
        const trackEvent: any = {
          ...trackProperties,
          ...ids,
        };
        // @ts-ignore
        gtag("event", payload.event, trackEvent);
        break;
      case "identify":
        const { traits } = payload;
        const identifyEvent: any = {
          ...traits,
          ...ids,
        };
        // @ts-ignore
        gtag("event", "identify", identifyEvent);
        break;
    }
  },
};

type GtmState = "fresh" | "loading" | "loaded" | "failed";

function getGa4State(): GtmState {
  return window["__jitsuGa4State"] || "fresh";
}

function setGa4State(s: GtmState) {
  window["__jitsuGa4State"] = s;
}

async function initGa4IfNeeded(config: Ga4DestinationCredentials, payload: AnalyticsClientEvent) {
  if (getGa4State() !== "fresh") {
    return;
  }
  setGa4State("loading");

  const dlName = config.dataLayerName || "dataLayer";
  const dlParam = dlName !== "dataLayer" ? "&l=" + dlName : "";

  // to work with both GA4 and GTM
  const tagId = config.measurementIds;
  const scriptSrc = `${defaultScriptSrc}?id=${tagId}${dlParam}`;

  window[dlName] = window[dlName] || [];
  const gtag = function () {
    window[dlName].push(arguments);
  };
  // @ts-ignore
  gtag("js", new Date());
  gtag(
    // @ts-ignore
    "config",
    tagId,
    {
      ...(payload.userId ? { user_id: payload.userId } : {}),
      ...(!config.autoPageView ? { send_page_view: false } : {}),
    }
  );

  loadScript(scriptSrc)
    .then(() => {
      setGa4State("loaded");
    })
    .catch(e => {
      console.warn(`GA4 (containerId=${config.measurementIds}) init failed: ${e.message}`, e);
      setGa4State("failed");
    });
}
