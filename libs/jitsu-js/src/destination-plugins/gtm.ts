import { loadScript } from "../script-loader";
import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";

const defaultScriptSrc = "https://www.googletagmanager.com/gtag/js";

export type GtmDestinationCredentials = {
  debug: boolean;
  containerId: string;
  dataLayerName: string;
  preview: string;
  auth: string;
  customScriptSrc: string;
} & CommonDestinationCredentials;

export const gtmPlugin: InternalPlugin<GtmDestinationCredentials> = {
  id: "gtm",
  async handle(config, payload: AnalyticsClientEvent) {
    if (!applyFilters(payload, config)) {
      return;
    }
    await initGtmIfNeeded(config);

    const dataLayer = window[config.dataLayerName || "dataLayer"];

    switch (payload.type) {
      case "page":
        const { properties: pageProperties, context } = payload;
        const pageEvent = {
          event: "page_view",
          url: pageProperties.url,
          title: pageProperties.title,
          referer: context?.page?.referrer ?? "",
        };
        if (config.debug) {
          console.log("gtag push", pageEvent);
        }
        dataLayer.push(pageEvent);
        break;
      case "track":
        const { properties: trackProperties } = payload;
        const trackEvent: any = { event: payload.event, ...trackProperties };
        if (payload.userId) {
          trackEvent.userId = payload.userId;
        }
        if (payload.anonymousId) {
          trackEvent.anonymousId = payload.anonymousId;
        }
        if (config.debug) {
          console.log("gtag push", trackEvent);
        }
        dataLayer.push(trackEvent);
        break;
      case "identify":
        const { traits } = payload;
        const identifyEvent: any = { event: "identify", ...traits };
        if (payload.userId) {
          identifyEvent.userId = payload.userId;
        }
        if (payload.anonymousId) {
          identifyEvent.anonymousId = payload.anonymousId;
        }
        if (config.debug) {
          console.log("gtag push", identifyEvent);
        }
        dataLayer.push(identifyEvent);
        break;
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

async function initGtmIfNeeded(config: GtmDestinationCredentials) {
  if (getGtmState() !== "fresh") {
    return;
  }
  setGtmState("loading");

  const dlName = config.dataLayerName || "dataLayer";
  const dlParam = dlName !== "dataLayer" ? "&l=" + dlName : "";
  const previewParams = config.preview
    ? `&gtm_preview=${config.preview}&gtm_auth=${config.auth}&gtm_cookies_win=x`
    : "";
  const scriptSrc = `${config.customScriptSrc || defaultScriptSrc}?id=${config.containerId}${dlParam}${previewParams}`;

  window[dlName] = window[dlName] || [];
  const gtag = function () {
    window[dlName].push(arguments);
  };
  // @ts-ignore
  gtag("js", new Date());
  // @ts-ignore
  gtag("config", config.containerId);

  loadScript(scriptSrc)
    .then(() => {
      setGtmState("loaded");
    })
    .catch(e => {
      console.warn(`GTM (containerId=${config.containerId}) init failed: ${e.message}`, e);
      setGtmState("failed");
    });
}
