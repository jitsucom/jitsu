import { loadScript } from "../script-loader";
import { AnalyticsClientEvent } from "@jitsu/protocols/analytics";
import { applyFilters, CommonDestinationCredentials, InternalPlugin } from "./index";

export type LogRocketDestinationCredentials = {
  appId: string;
} & CommonDestinationCredentials;

export const logrocketPlugin: InternalPlugin<LogRocketDestinationCredentials> = {
  id: "logrocket",
  async handle(config, payload: AnalyticsClientEvent) {
    if (!applyFilters(payload, config)) {
      return;
    }
    initLogrocketIfNeeded(config.appId);

    const action = logRocket => {
      if (payload.type === "identify" && payload.userId) {
        logRocket.identify(payload.userId, payload.traits || {});
      }
    };
    getLogRocketQueue().push(action);
    if (getLogRocketState() === "loaded") {
      flushLogRocketQueue(window["LogRocket"]);
    }
  },
};

type LogRocketState = "fresh" | "loading" | "loaded" | "failed";

function getLogRocketState(): LogRocketState {
  return window["__jitsuLrState"] || "fresh";
}

function setLogRocketState(s: LogRocketState) {
  window["__jitsuLrState"] = s;
}

function getLogRocketQueue(): ((lr: LogRocket) => void | Promise<void>)[] {
  return window["__jitsuLrQueue"] || (window["__jitsuLrQueue"] = []);
}

export type LogRocket = any;

function flushLogRocketQueue(lr: LogRocket) {
  const queue = getLogRocketQueue();

  while (queue.length > 0) {
    const method = queue.shift();
    try {
      const res = method(lr);
      if (res) {
        res.catch(e => console.warn(`Async LogRocket method failed: ${e.message}`, e));
      }
    } catch (e) {
      console.warn(`LogRocket method failed: ${e.message}`, e);
    }
  }
}

async function initLogrocketIfNeeded(appId: string) {
  if (getLogRocketState() !== "fresh") {
    return;
  }
  setLogRocketState("loading");
  loadScript(`https://cdn.lr-ingest.io/LogRocket.min.js`, { crossOrigin: "anonymous" })
    .then(() => {
      if (window["LogRocket"]) {
        try {
          window["LogRocket"].init(appId);
        } catch (e) {
          console.warn(`LogRocket (id=${appId}) init failed: ${e.message}`, e);
          setLogRocketState("failed");
        }
        setLogRocketState("loaded");
        flushLogRocketQueue(window["LogRocket"]);
      }
    })
    .catch(e => {
      console.warn(`LogRocket (id=${appId}) init failed: ${e.message}`, e);
      setLogRocketState("failed");
    });
}
