import { createContext } from "react";
import { AnalyticsInterface } from "@jitsu/js";

export type JitsuInstance = { analytics: AnalyticsInterface };

const JitsuContext = createContext<JitsuInstance | null>(null);

export default JitsuContext;
