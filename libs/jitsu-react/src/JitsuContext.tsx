import { createContext } from "react";
import { AnalyticsInterface } from "@jitsu/js/compiled/src";

export type JitsuInstance = { analytics: AnalyticsInterface };

const JitsuContext = createContext<JitsuInstance | null>(null);

export default JitsuContext;
