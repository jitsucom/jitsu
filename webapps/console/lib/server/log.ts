import { getLog, LoggerOpts, LogLevel, setGlobalLogLevel, setServerJsonFormat, setServerLogColoring } from "juava";
import { getServerEnv } from "./serverEnv";

const serverEnv = getServerEnv();

setGlobalLogLevel((serverEnv.LOG_LEVEL || "info") as LogLevel);
setServerLogColoring(!serverEnv.DISABLE_SERVER_LOGS_ANSI_COLORING);
setServerJsonFormat(serverEnv.LOG_FORMAT === "json");

export function getServerLog(_opts?: LoggerOpts | string) {
  return getLog(_opts);
}
