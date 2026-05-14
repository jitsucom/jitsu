import { logType } from "@jitsu/core-functions-lib";
import React from "react";
import dayjs from "dayjs";

const localDate = (date: string | Date) => dayjs(date).format("YYYY-MM-DD HH:mm:ss");

function formatArg(arg: any): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function isHttpRequestMessage(msg: any): boolean {
  return msg && typeof msg === "object" && msg.type === "http-request";
}

function formatHttpRequest(msg: any): string {
  const method = msg.method || "GET";
  const url = msg.url || "";
  const status =
    msg.status !== undefined
      ? `${msg.status}${msg.statusText ? " " + msg.statusText : ""}`
      : msg.error
      ? `ERROR: ${msg.error}`
      : "";
  const elapsed = msg.elapsedMs !== undefined ? ` (${msg.elapsedMs}ms)` : "";
  return `${method} ${url}${status ? ` — ${status}` : ""}${elapsed}`;
}

function formatLogMessage(msg: any): string {
  if (typeof msg === "string") return msg;
  if (isHttpRequestMessage(msg)) return formatHttpRequest(msg);
  if (msg && typeof msg === "object" && typeof msg.text === "string") return msg.text;
  return formatArg(msg);
}

function getLogLevel(log: logType): string {
  if (isHttpRequestMessage(log.message)) {
    return (log.message as any).error ? "error" : "debug";
  }
  return log.level;
}

export const FunctionLogs: React.FC<{ logs: logType[]; className?: string; showDate?: boolean }> = ({
  logs,
  className,
  showDate,
}) => {
  return (
    <div
      className={`${
        className ?? ""
      } flex-auto flex flex-col place-content-start flex-nowrap pb-4 bg-backgroundLight w-full h-full`}
    >
      {logs.map((log, index) => {
        const level = getLogLevel(log);
        const colors = (() => {
          switch (level) {
            case "error":
              return { text: "#A4000F", bg: "#FDF3F5", border: "#F8D6DB" };
            case "debug":
              return { text: "#646464", bg: "#FBF3F5", border: "#FBF3F5" };
            case "warn":
              return { text: "#705100", bg: "#FFFBD6", border: "#F4E89A" };
            default:
              return { text: "black", bg: "white", border: "#eaeaea" };
          }
        })();
        return (
          <div
            key={index}
            style={{ borderColor: colors.border, backgroundColor: colors.bg }}
            className={"font-mono text-xs shrink-0 gap-x-6 w-full flex flex-row border-b py-0.5 px-3"}
          >
            {showDate && <div className={"text-textLight whitespace-nowrap"}>{localDate(log.timestamp)}</div>}
            <div style={{ color: colors.text }} className={"w-10 flex-grow-0 flex-shrink-0 whitespace-nowrap"}>
              {level.toUpperCase()}
            </div>
            <div style={{ color: colors.text }} className={"flex-auto whitespace-pre-wrap break-all"}>
              {[formatLogMessage(log.message), ...(log.args || []).map(formatArg)].join(", ")}
            </div>
          </div>
        );
      })}
    </div>
  );
};
