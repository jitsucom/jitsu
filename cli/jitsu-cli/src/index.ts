import figlet from "figlet";
import { Command } from "commander";
import { login, logout } from "./commands/login";
import { deploy } from "./commands/deploy";
import { init } from "./commands/init";
import { build } from "./commands/build";
import { test } from "./commands/test";
import { run } from "./commands/run";

import { jitsuCliVersion, jitsuCliPackageName } from "./lib/version";

console.log(figlet.textSync("Jitsu CLI", { horizontalLayout: "full" }));

const p = new Command();

p.name(jitsuCliPackageName).description("CLI command to create, test and deploy extensions for Jitsu Next");
p.command("init")
  .description("Initialize a new Jitsu extension project")
  .arguments("[dir]")
  .option("-j, --jitsu-version <version>", "Jitsu version to use in package.json. (Optional)")
  .option("--allow-non-empty-dir", "Allow to create project in non-empty directory. (Optional)")
  .action(init);

p.command("build")
  .description("Build the extension")
  .option("-d, --dir <dir>", "the directory of project. (Optional). By default, current directory is used")
  .action(build);

p.command("test")
  .description("Run test provided with the extension")
  .option("-d, --dir <dir>", "the directory of project. (Optional). By default, current directory is used")
  .action(test);

p.command("run")
  .description("Check extensions on provided event, config and persistent storage state")
  .option("-d, --dir <dir>", "the directory of project. (Optional). By default, current directory is used")
  .option(
    "-n, --name <name>",
    "name of function file to check (optional). Required if multiple functions are defined in project"
  )
  .option("-t, --type <type>", "entity type to run", "function")
  .requiredOption("-e, --event <file_or_json>", "path to file with event json or event json as a string")
  .option("-p, --props <file_or_json>", "path to file with config json or config json as a string. (Optional)")
  .option("-s, --store <file_or_json>", "path to file with state json or state json as a string. (Optional)")
  .action(run);

p.command("login")
  .description("Login to Jitsu and remember credentials in `~/.jitsu/jitsu-cli.json` file")
  .option("-f, --force", "If user already logged in, replace existing session")
  .option("-h, --host <host>", "Jitsu host or base url", "https://use.jitsu.com")
  .option("-k, --apikey <api-key>", "Jitsu user's Api Key. (Optional). Disables interactive login.")
  .action(login);
p.command("logout").description("Logout").option("-f, --force", "Do not ask for confirmation").action(logout);

p.command("deploy")
  .description("Deploy functions to Jitsu project")
  .option("-d, --dir <dir>", "the directory of project. (Optional). By default, current directory is used")
  .option(
    "-h, --host <host>",
    "(Optional) Jitsu host or base url. Useful for CI, if it's not possible to run login beforehand",
    "https://use.jitsu.com"
  )
  .option("-k, --apikey <api-key>", "(Optional) Jitsu user's Api Key.")
  .option(
    "-w, --workspace <workspace-id>",
    "Id of workspace where to deploy function (Optional). By default, interactive prompt is shown to select workspace"
  )
  .option("-t, --type <type>", "entity type to deploy", "function")
  .option("-n, --name <name...>", "limit deploy to provided entities only. (Optional)")
  .action(deploy);

//version
p.version(jitsuCliPackageName + " " + jitsuCliVersion, "-v, --version");
//help
p.helpOption("--help", "display help for command");

p.parse();
