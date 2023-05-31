import * as React from "react";
import { PropsWithChildren, useMemo } from "react";
import JitsuContext, { JitsuInstance } from "./JitsuContext";
import { emptyAnalytics, jitsuAnalytics } from "@jitsu/js";
import { ExtendedJitsuOptions } from "./useJitsu";

const JitsuProvider: React.FC<PropsWithChildren<{ options: ExtendedJitsuOptions }>> = props => {
  const instance: JitsuInstance = useMemo(() => {
    if (props.options.disabled) {
      return { analytics: emptyAnalytics };
    } else if (!props.options.host) {
      const msg = "<JitsuProvider />. Jitsu host is not defined. Jitsu will not be initialized";
      console.error(`%c${msg}`, "color: red; font-weight: bold;");
      return { analytics: emptyAnalytics };
    } else {
      return { analytics: jitsuAnalytics(props.options) };
    }
  }, [props.options.disabled, props.options.host]);
  return <JitsuContext.Provider value={instance}>{props.children}</JitsuContext.Provider>;
};

export default JitsuProvider;
