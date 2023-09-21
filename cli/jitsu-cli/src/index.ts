import figlet from "figlet";
import { Command } from "commander";
import { login } from "./commands/login";
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
  .option(
    "-n, --name <name>",
    "the name of the project. It will be used as a package name and directory name. (Optional). By default, interactive prompt is shown to enter the name."
  )
  .option(
    "-N, --displayname <name>",
    "human-readable function name that will be used in Jitsu. (Optional). By default, interactive prompt is shown to enter the name."
  )
  .option(
    "-p, --parent <dir>",
    "the parent directory of project. (Optional). By default, interactive prompt is shown to enter the parent directory."
  )
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
  .option("--host <host>", "Jitsu host or base url", "https://use.jitsu.com")
  .option("-k, --apikey <api-key>", "Jitsu user's Api Key. (Optional). Disables interactive login.")
  .action(login);

p.command("deploy")
  .description("Deploy functions to Jitsu project")
  .option("-d, --dir <dir>", "the directory of project. (Optional). By default, current directory is used")
  .option(
    "-w, --workspace <workspace-id>",
    "Id of workspace where to deploy function (Optional). By default, interactive prompt is shown to select workspace"
  )
  .option("-t, --type <type>", "entity type to deploy", "function")
  .option("-n, --name <name...>", "limit deploy to provided entities only. (Optional)")
  .action(deploy);

//version
p.version(jitsuCliPackageName + " " + jitsuCliVersion, "-v, --version");

p.parse();
