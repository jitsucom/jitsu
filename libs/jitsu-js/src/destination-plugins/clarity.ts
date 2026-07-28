import { loadScript } from "../script-loader";
import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";

export type ClarityDestinationCredentials = {
  // Clarity Project ID. Doubles as the API key - no separate key needed.
  projectId: string;
  // When true, Jitsu calls clarity('consent') right after the tag loads.
  cookieConsent?: boolean;
  // When false, Jitsu does not inject the Clarity tag - the page is expected to load it itself
  // (e.g. via its own snippet or a tag manager). Jitsu still forwards events to the existing
  // window.clarity. The projectId is only used when Jitsu loads the tag. Default true.
  loadClarity?: boolean;
  // What to do with `track` event properties. Clarity events carry only a name, so the only
  // way to attach properties is as custom tags via clarity('set', ...). "tags" (default) does
  // that, "ignore" drops them.
  trackProperties?: "tags" | "ignore";
} & CommonDestinationCredentials;

type ClarityState = "fresh" | "loading" | "loaded" | "failed";

function getClarityState(): ClarityState {
  return window["__jitsuClarityState"] || "fresh";
}

function setClarityState(s: ClarityState) {
  window["__jitsuClarityState"] = s;
}

// clarity('set', key, value) only accepts a string or an array of strings. Coerce anything else,
// dropping values that can't be sensibly represented as a tag.
function coerceTagValue(value: any): string | string[] | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const arr = value.filter(v => v !== null && v !== undefined).map(v => String(v));
    return arr.length > 0 ? arr : undefined;
  }
  return undefined;
}

function setTags(clarity: (...args: any[]) => void, obj: Record<string, any> | undefined) {
  if (!obj) {
    return;
  }
  for (const [key, rawValue] of Object.entries(obj)) {
    const value = coerceTagValue(rawValue);
    if (value !== undefined) {
      clarity("set", key, value);
    }
  }
}

export const clarityPlugin: InternalPlugin<ClarityDestinationCredentials> = {
  id: "clarity",
  async handle(config, payload: AnalyticsClientEvent) {
    if (!applyFilters(payload, config)) {
      return;
    }
    initClarityIfNeeded(config);

    // The vendor snippet installs a self-queuing stub, so calls made before the script finishes
    // loading are queued by Clarity itself - no need for our own flush queue.
    const clarity = window["clarity"];
    if (typeof clarity !== "function") {
      return;
    }

    // traits could be in both nodes, context.traits takes precedence
    const traits = {
      ...(payload.traits || {}),
      ...(payload.context?.traits || {}),
    };

    switch (payload.type) {
      case "identify": {
        if (payload.userId) {
          const friendlyName = traits.name || traits.email;
          clarity("identify", payload.userId, undefined, undefined, friendlyName);
        }
        setTags(clarity, traits);
        break;
      }
      case "track": {
        if (payload.event) {
          clarity("event", payload.event);
        }
        if ((config.trackProperties ?? "tags") === "tags") {
          setTags(clarity, payload.properties);
        }
        break;
      }
      // `page` is intentionally a no-op. Clarity has no stateChange/page-view API (its whole
      // client API is identify/set/event/consent/upgrade), and it already auto-tracks navigation
      // - including SPA route changes - exposing URL as a native filter. So there is nothing
      // useful to call here, unlike Hotjar where `page` -> hj('stateChange') fills a real gap.
    }
  },
};

function initClarityIfNeeded(config: ClarityDestinationCredentials) {
  if (getClarityState() !== "fresh") {
    return;
  }
  setClarityState("loading");

  // Install the self-queuing stub (mirrors Clarity's official snippet). Even when Jitsu does not
  // load the tag, this ensures events fired before the page's own Clarity script runs are queued
  // and drained by it once it loads.
  window["clarity"] =
    window["clarity"] ||
    function () {
      (window["clarity"].q = window["clarity"].q || []).push(arguments);
    };

  if (config.loadClarity !== false) {
    loadScript(`clarity.ms/tag/${config.projectId}`, { www: true })
      .then(() => {
        setClarityState("loaded");
      })
      .catch(e => {
        console.warn(`Clarity (projectId=${config.projectId}) init failed: ${e.message}`, e);
        setClarityState("failed");
      });
  } else {
    // The page loads the Clarity tag itself; we only forward events to it.
    setClarityState("loaded");
  }

  if (config.cookieConsent) {
    window["clarity"]("consent");
  }
}
