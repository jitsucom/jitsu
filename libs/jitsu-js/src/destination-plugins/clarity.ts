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

// "passive" = a loadClarity===false destination installed the stub and forwards events, but no real
// SDK has been loaded by us yet; a later load-enabled destination may still transition to "loading".
type ClarityState = "fresh" | "passive" | "loading" | "loaded" | "failed";

function getClarityState(): ClarityState {
  return window["__jitsuClarityState"] || "fresh";
}

function setClarityState(s: ClarityState) {
  window["__jitsuClarityState"] = s;
}

// The projectId of the destination that actually loaded the tag. window.clarity is a vendor-owned
// singleton, so only one project can be active per page; we track it to warn on misconfiguration.
function getClarityProjectId(): string | undefined {
  return window["__jitsuClarityProjectId"];
}

function setClarityProjectId(id: string) {
  window["__jitsuClarityProjectId"] = id;
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

    // Tag load failed: the stub has been swapped for a no-op and its queue dropped. Short-circuit so
    // we don't keep handing work to a dead instance.
    if (getClarityState() === "failed") {
      return;
    }

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
  const state = getClarityState();

  // Once a load-enabled destination has taken ownership of the tag, no other destination can change
  // that - window.clarity is a singleton. Warn on a projectId mismatch so the misconfiguration is
  // visible; the destination that loaded the tag wins.
  if (state === "loading" || state === "loaded" || state === "failed") {
    const activeProjectId = getClarityProjectId();
    if (config.loadClarity !== false && activeProjectId && activeProjectId !== config.projectId) {
      console.warn(
        `Clarity: a destination for projectId=${activeProjectId} is already active on this page; ` +
          `ignoring projectId=${config.projectId}. Multiple Clarity destinations on one page are not supported.`
      );
    }
    return;
  }

  // state is "fresh" or "passive". Install the self-queuing stub (mirrors Clarity's official
  // snippet) once - idempotent via `|| function(){}`. Even when Jitsu does not load the tag, this
  // ensures events fired before the page's own Clarity script runs are queued and drained once it
  // loads.
  window["clarity"] =
    window["clarity"] ||
    function () {
      (window["clarity"].q = window["clarity"].q || []).push(arguments);
    };

  if (config.loadClarity !== false) {
    // This destination loads the tag - take ownership even if a passive destination ran first, so a
    // "load it yourself" destination processed earlier never strands us with only the stub.
    setClarityState("loading");
    setClarityProjectId(config.projectId);
    loadScript(`clarity.ms/tag/${config.projectId}`, { www: true })
      .then(() => {
        setClarityState("loaded");
      })
      .catch(e => {
        console.warn(`Clarity (projectId=${config.projectId}) init failed: ${e.message}`, e);
        setClarityState("failed");
        // Init failed: replace the queuing stub with a no-op and drop its queue so events fired for
        // the rest of the page lifetime don't accumulate in window.clarity.q.
        window["clarity"] = function () {};
      });
    if (config.cookieConsent) {
      window["clarity"]("consent");
    }
  } else if (state === "fresh") {
    // The page loads the Clarity tag itself; we only forward events to it. Stay in a transitional
    // "passive" state (not "loaded") so a later load-enabled destination can still load the real
    // SDK instead of being stranded at the guard above. Guard on "fresh" so we don't re-run the
    // one-time consent call on every event.
    setClarityState("passive");
    if (config.cookieConsent) {
      window["clarity"]("consent");
    }
  }
}
