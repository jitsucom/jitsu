import minimist from "minimist";
import { docker } from "./docker";

const commands: Record<string, (args: minimist.ParsedArgs) => Promise<void>> = {
  docker: docker,
};

async function main() {
  const argv = minimist(process.argv.slice(2));
  if (argv._.length === 0) {
    console.error(`No command specified. Specify one of the following commands: ${Object.keys(commands).join(", ")}`);
    process.exit(1);
  }
  const commandName = argv._[0];
  const cmd = commands[commandName];

  if (!cmd) {
    console.error(`Unknown command: ${commandName}. Available commands: ${Object.keys(commands).join(", ")}`);
    process.exit(1);
  }
  argv._.shift();
  try {
    await cmd(argv);
    process.exit(0);
  } catch (error: any) {
    const msg = `Command ${commandName} failed: ${error?.message || "Unknown error"}`;
    if (argv.debug) {
      console.error(msg, error);
    } else {
      console.error(msg);
    }
    console.error(msg);
    process.exit(1);
  }
}

main();
