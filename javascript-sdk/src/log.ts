import { isWindowAvailable } from "./window"

/**
 * Interface for logging. Plugins might use it
 * internally
 */
export type Logger = {
  debug: (...args: any) => void
  info: (...args: any) => void
  warn: (...args: any) => void
  error: (...args: any) => void
}

export type LogLevelName = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE';

export type LogLevel = {
  name: LogLevelName
  severity: number
}


export const LogLevels: Record<LogLevelName, LogLevel> = {
  DEBUG: {name: "DEBUG", severity: 10},
  INFO: {name: "INFO", severity: 100},
  WARN: {name: "WARN", severity: 1000},
  ERROR: {name: "ERROR", severity: 10000},
  NONE: {name: "NONE", severity: 10000}
}

let rootLogger = null;

/**
 * Create logger or return cached instance
 */
export function getLogger(): Logger {
  if (rootLogger) {
    return rootLogger;
  }  else {
    return rootLogger = createLogger();
  }
}

export function setRootLogLevel(logLevelName: LogLevelName): Logger {
  let logLevel = LogLevels[logLevelName.toLocaleUpperCase()];
  if (!logLevel) {
    console.warn(`Can't find log level with name ${logLevelName.toLocaleUpperCase()}, defaulting to INFO`);
    logLevel = LogLevels.INFO;
  }
  rootLogger = createLogger(logLevel);
  return rootLogger;
}

export function setDebugVar(name: string, val: any) {
  if (!isWindowAvailable()) {
    return;
  }
  let win = window as any;
  if (!win.__jitsuDebug) {
    win.__jitsuDebug = { };
  }
  win.__jitsuDebug[name] = val;
}




/**
 * Creates a loggger with given log-level
 * @param logLevel
 */
export function createLogger(logLevel?: LogLevel): Logger {
  let globalLogLevel = isWindowAvailable() && (window as any)['__eventNLogLevel'];

  let minLogLevel = LogLevels.WARN;
  if (globalLogLevel) {
    let level = (LogLevels as any)[globalLogLevel.toUpperCase()];
    if (level && level > 0) {
      minLogLevel = level as LogLevel
    }
  } else if (logLevel) {
    minLogLevel = logLevel;
  }
  const logger = {minLogLevel}
  Object.values(LogLevels).forEach(({name, severity}) => {
    (logger as any)[name.toLowerCase()] = (...args: any[]) => {
      if (severity >= minLogLevel.severity && args.length > 0) {
        const message = args[0];
        const msgArgs = args.splice(1);
        let msgFormatted = `[J-${name}] ${message}`;
        if (name === 'DEBUG' || name === 'INFO') {
          console.log(msgFormatted, ...msgArgs);
        } else if (name === 'WARN') {
          console.warn(msgFormatted, ...msgArgs);
        } else {
          console.error(msgFormatted, ...msgArgs);
        }
      }
    }
  });
  setDebugVar("logger", logger);

  return logger as any as Logger;
}
