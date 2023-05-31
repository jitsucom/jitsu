import { main } from "./main";
import minimist from "minimist";
import chalk from "chalk";
import { getErrorMessage } from "juava";

(async function (): Promise<any> {
  try {
    const exitCode = await main(minimist(process.argv.slice(2)));
    process.exit(exitCode || 0);
  } catch (e: any) {
    process.stderr.write(chalk.red("Error!") + " - " + getErrorMessage(e) + "\n");
    if (e?.stack) {
      process.stderr.write(`\n${e?.stack}\n`);
    }
  }
})();
