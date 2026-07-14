import {
  getLog,
  LoggerOpts,
  LogLevel,
  setGlobalLogLevel,
  setLogContextProvider,
  setServerJsonFormat,
  setServerLogColoring,
} from "juava";
import { getServerEnv } from "./serverEnv";
import { getRequestContext } from "./request-context";

const serverEnv = getServerEnv();

setGlobalLogLevel((serverEnv.LOG_LEVEL || "info") as LogLevel);
setServerLogColoring(!serverEnv.DISABLE_SERVER_LOGS_ANSI_COLORING);
setServerJsonFormat(serverEnv.LOG_FORMAT === "json");
// Merge request-scoped fields (request_id, …) into every JSON log line.
setLogContextProvider(getRequestContext);

export function getServerLog(_opts?: LoggerOpts | string) {
  return getLog(_opts);
}
