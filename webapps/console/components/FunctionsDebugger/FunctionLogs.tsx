import { logType } from "@jitsu/core-functions";
import React from "react";
import dayjs from "dayjs";

const localDate = (date: string | Date) => dayjs(date).format("YYYY-MM-DD HH:mm:ss");

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
        const colors = (() => {
          switch (log.level) {
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
              {log.level.toUpperCase()}
            </div>
            <div style={{ color: colors.text }} className={"flex-auto whitespace-pre-wrap break-all"}>
              {log.message}
            </div>
          </div>
        );
      })}
    </div>
  );
};
