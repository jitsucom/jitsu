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

export type LogLevel = {
  name: string
  severity: number
}


export const LogLevels: Record<string, LogLevel> = {
  DEBUG: {name: "DEBUG", severity: 10},
  INFO: {name: "INFO", severity: 100},
  WARN: {name: "WARN", severity: 1000},
  ERROR: {name: "ERRO", severity: 10000}
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



/**
 * Creates a loggger with given log-level
 * @param logLevel
 */
export function createLogger(logLevel?: LogLevel): Logger {
  let globalLogLevel = (window as any)['__eventNLogLevel'];

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
        if (name === 'DEBUG' || name === 'INFO') {
          console.log(message, ...msgArgs);
        } else if (name === 'WARN') {
          console.warn(message, ...msgArgs);
        } else {
          console.error(message, ...msgArgs);
        }
      }
    }
  });
  (window as any)['__eventNLogger'] = logger;

  return logger as any as Logger;
}
