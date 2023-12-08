import * as process from "process";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LoggerOpts = {
  level?: LogLevel;
  component?: string;
};
const levelSeverities: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getComponent() {
  return undefined;
}

let globalLogLevel: LogLevel = (process.env.JUAVA_GLOBAL_LOG_LEVEL || "info") as LogLevel;
let enableServerLogsColoring: boolean = !(process.env.CI === "1" || process.env.CI === "true");
let enableJsonFormat: boolean = false;

export function setGlobalLogLevel(level: LogLevel) {
  globalLogLevel = level;
}

export function setServerLogColoring(enableColoring: boolean) {
  enableServerLogsColoring = enableColoring;
}

export function setServerJsonFormat(enableJson: boolean) {
  enableJsonFormat = enableJson;
}

export function getLog(_opts?: LoggerOpts | string): LogFactory {
  const opts = typeof _opts === "string" ? { component: _opts } : _opts || {};
  const { level, component = getComponent() } = opts;
  return {
    atDebug(): LogMessageBuilder {
      const minSeverity = levelSeverities[level || globalLogLevel || "info"];
      return minSeverity <= levelSeverities.debug ? logMessageBuilder(component, "debug") : noopLogMessageBuilder;
    },
    atError(): LogMessageBuilder {
      const minSeverity = levelSeverities[level || globalLogLevel || "info"];
      return minSeverity <= levelSeverities.error ? logMessageBuilder(component, "error") : noopLogMessageBuilder;
    },
    atInfo(): LogMessageBuilder {
      const minSeverity = levelSeverities[level || globalLogLevel || "info"];
      return minSeverity <= levelSeverities.info ? logMessageBuilder(component, "info") : noopLogMessageBuilder;
    },
    atWarn(): LogMessageBuilder {
      const minSeverity = levelSeverities[level || globalLogLevel || "info"];
      return minSeverity <= levelSeverities.warn ? logMessageBuilder(component, "warn") : noopLogMessageBuilder;
    },
  };
}

const colorsAnsi: Record<string, string> = {
  blue: "\x1b[34m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
} as const;

const browserColors: Record<keyof typeof colorsAnsi, string> = {
  cyan: "magenta",
  yellow: "orange",
};

type Color = (typeof colorsAnsi)[0] | undefined;

const levelColors: Record<LogLevel, Color> = {
  debug: "cyan",
  error: "red",
  info: "green",
  warn: "yellow",
} as const;

function inBrowser() {
  // @ts-ignore
  return typeof window !== "undefined";
}

export const logFormat = {
  bold(msg: string): string {
    return msg;
  },
  italic(msg: string): string {
    return msg;
  },
  color(color: Color, str: string): string {
    //to implement bold and italic we should split string by [0m and apply bold/italic to each part
    return !inBrowser() && enableServerLogsColoring && color !== undefined
      ? str
          .split("\n")
          .map(line => `${colorsAnsi[color]}${line}\x1b[0m`)
          .join("\n")
      : str;
  },
};

//process.stdout is not available on Vercel's edge runtime
const writeln = process.stdout
  ? (msg: string) => {
      process.stdout.write(msg);
      process.stdout.write("\n");
    }
  : console.log;

function dispatch(msg: LogMessage) {
  const levelColor = levelColors[msg.level];
  let logPrefix = `${msg.component ? ` [${msg.component}]: ` : ": "}`;
  if (!enableJsonFormat) {
    const timeFormatted = msg.date.toISOString().split("T").join(" ");
    const levelFormatted = msg.level.toUpperCase().padEnd(5);
    logPrefix = `${timeFormatted} ${levelFormatted}${logPrefix}`;
  }
  if (inBrowser()) {
    const color = browserColors[levelColor || ""] || levelColor;
    const fullArgs = [...(msg.args || []), ...(msg.errorCause ? [msg.errorCause] : [])];
    console.log(`%c${logPrefix}${msg.message}`, `color: ${color}`, ...fullArgs);
  } else {
    const lines = [...`${logPrefix}${msg.message}${msg.args ? " " + msg.args.join(" ") : ""}`.split("\n")];
    if (msg.errorCause) {
      if (msg.errorCause.message && !msg.errorCause.stack) {
        lines.push("Error! - " + msg.errorCause.message);
      }
      if (msg.errorCause.stack) {
        lines.push(...msg.errorCause.stack.split("\n"));
      }
    }
    if (enableJsonFormat) {
      writeln(JSON.stringify({ time: msg.date, level: msg.level, msg: lines.join("\n") }));
    } else {
      const border = ""; // = "｜";
      const messageFormatted = lines.join(`\n${border} `);
      writeln(logFormat.color(levelColor, messageFormatted));
    }
  }
  msg.dispatched = true;
}

function logMessageBuilder(component: string | undefined, level: LogLevel): LogMessageBuilder {
  const workInProgress: Partial<LogMessage> = { dispatched: false, component, date: new Date(), level };
  return {
    log(message: string, ...args: any[]) {
      workInProgress.message = message;
      workInProgress.args = args;
      dispatch(workInProgress as LogMessage);
    },
    withCause(cause: any): LogMessageBuilder {
      if (workInProgress.dispatched) {
        return noopLogMessageBuilder;
      } else {
        workInProgress.errorCause = cause;
        return this;
      }
    },
  };
}

export type LogMessage = {
  date: Date;
  level: LogLevel;
  dispatched: boolean;
  component?: string;
  message: string;
  args: any[];
  errorCause?: any;
};

export type LogFactory = {
  atInfo(): LogMessageBuilder;
  atWarn(): LogMessageBuilder;
  atError(): LogMessageBuilder;
  atDebug(): LogMessageBuilder;
};

export type LogMessageBuilder = {
  withCause(cause: any): LogMessageBuilder;
  log(message: string, ...args: any[]);
};

export const noopLogMessageBuilder: LogMessageBuilder = {
  log() {},
  withCause(cause: Error): LogMessageBuilder {
    return noopLogMessageBuilder;
  },
};
