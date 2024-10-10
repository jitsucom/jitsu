process.env.JUAVA_LOG_LEVEL = 'debug';
global.console = {
  log: message => process.stdout.write(message + '\n'),
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};
