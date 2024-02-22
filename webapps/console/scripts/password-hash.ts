import minimist from "minimist";
import { createHash, randomId } from "juava";
import { getServerLog } from "../lib/server/log";

const log = getServerLog("password-hash");

async function main(): Promise<void> {
  const args = minimist(process.argv.slice(2));
  if (!args._ || args._.length === 0) {
    log.atInfo().log("No secret provided as a first arg, generating a random one");
  }
  const secret = !args._ || args._.length === 0 ? randomId(32) : args._[0];
  log
    .atInfo()
    .log(
      `Calculating password hash. Using ${
        process.env.GLOBAL_HASH_SECRET || process.env.CONSOLE_TOKEN_SECRET
          ? "custom token secret"
          : "default hash secret"
      }`
    );
  log.atInfo().log(`Hashing ${secret} → ${createHash(secret)}`);
}

main();
