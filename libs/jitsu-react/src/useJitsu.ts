import { useContext } from "react";
import JitsuContext from "./JitsuContext";

import { AnalyticsInterface, jitsuAnalytics, JitsuOptions, emptyAnalytics } from "@jitsu/js/compiled/src";

export interface BeforeEffect {
  effect: (analytics: AnalyticsInterface) => any;
  deps: any[];
}

export type ExtendedJitsuOptions =
  | (Omit<JitsuOptions, "host"> & { host: string } & {
      disabled?: false | undefined;
      echoEvents?: boolean;
    })
  | { disabled: true; host?: undefined };

/**
 * See for details http://jitsu.com/docs/sending-data/js-sdk/react
 */
function useJitsu(opts?: ExtendedJitsuOptions): { analytics: AnalyticsInterface } {
  let jitsuInstance = useContext(JitsuContext);
  if (opts?.disabled) {
    return { analytics: emptyAnalytics };
  }
  if (!jitsuInstance) {
    if (opts?.host || opts?.echoEvents) {
      return { analytics: jitsuAnalytics(opts) };
    } else {
      const msg =
        "Before calling useJitsu() hook, please wrap your component into <JitsuProvider />. Read more in http://jitsu.com/docs/sending-data/js-sdk/react";
      console.error(`%c${msg}`, "color: red; font-weight: bold;");
      return { analytics: emptyAnalytics };
    }
  } else if (opts?.host || opts?.echoEvents) {
    throw new Error(
      "Jitsu client already set up with <JitsuProvider /> and cannot be overridden. Read more in http://jitsu.com/docs/sending-data/js-sdk/react"
    );
    //Jitsu analytics is initialized inside provider
  } else if (jitsuInstance.analytics) {
    return jitsuInstance;
  } else {
    throw new Error(`<JitsuProvider /> is not initialized with undefined analytics instance`);
  }
}

export default useJitsu;
export { AnalyticsInterface, JitsuOptions };
