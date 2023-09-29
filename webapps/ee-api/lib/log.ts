import { getLog, LoggerOpts, LogLevel, setGlobalLogLevel, setServerJsonFormat, setServerLogColoring } from "juava";

setGlobalLogLevel((process.env.LOG_LEVEL || "info") as LogLevel);
setServerLogColoring(
  process.env.DISABLE_SERVER_LOGS_ANSI_COLORING !== "true" && process.env.DISABLE_SERVER_LOGS_ANSI_COLORING !== "1"
);
setServerJsonFormat(process.env.LOG_FORMAT === "json");

export function getServerLog(_opts?: LoggerOpts | string) {
  return getLog(_opts);
}
