const dotenv = require("dotenv");
const path = require("path");
function loadEnv() {
//read .env, jest won't do it automatically
  const projectRoot = path.join(__dirname, "../../");
  [".env", ".env.local", `.env.${process.env.NODE_ENV}`].forEach((file) => {
    dotenv.config({ path: path.join(projectRoot, file) });
  });
}



//replace jest verbose logging with ordinary logs
global.console = {
  log: message => process.stdout.write(message + '\n'),
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};


loadEnv();

