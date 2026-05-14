import figlet from "figlet";
import { Command } from "commander";
import { login, logout } from "./commands/login";
import { deploy } from "./commands/deploy";
import { init } from "./commands/init";
import { build } from "./commands/build";
import { test } from "./commands/test";

import { jitsuCliVersion, jitsuCliPackageName } from "./lib/version";
import { whoami } from "./commands/whoami";
import { buildConfigCommand } from "./commands/config";
import { buildSpecCommand } from "./commands/spec";
import { setDefaultWorkspace, unsetDefaultWorkspace } from "./commands/default-workspace";
import { preprocessArgv } from "./lib/body-fields";

// Pull ad-hoc body field flags (--name=val, --credentials.password=...) out of argv
// before Commander parses it. Reserved option names are left in place.
process.argv = preprocessArgv(process.argv);

// Figlet banner is decorative — write it to stderr so `jitsu config ... -o json | jq`
// works without filtering. Skip it entirely when stdout is being piped or for spec output
// (which is also typically piped to other tools).
const isPipedStdout = !process.stdout.isTTY;
if (!isPipedStdout) {
  process.stderr.write(figlet.textSync("Jitsu CLI", { horizontalLayout: "full" }) + "\n");
}

const p = new Command();

p.name(jitsuCliPackageName).description("Jitsu CLI — manage workspaces, configuration objects, and extensions");

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

p.command("whoami")
  .description("Check if current user is logged in. Shows user's info if logged in")
  .option("-h, --host <host>", "Jitsu host or base url", "https://use.jitsu.com")
  .option("-k, --apikey <api-key>", "Jitsu user's Api Key. (Optional). Disables interactive login.")
  .action(whoami);

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

p.command("set-default-workspace")
  .description(
    "Save a default workspace to ~/.jitsu/jitsu-cli.json. Subsequent `jitsu config` commands use it when -w is omitted."
  )
  .argument("<id-or-slug>", "Workspace id or slug")
  .option("-h, --host <host>", "Jitsu host (overrides ~/.jitsu/jitsu-cli.json)")
  .option("-k, --apikey <api-key>", "API key in form keyId:secret (overrides ~/.jitsu/jitsu-cli.json)")
  .action(setDefaultWorkspace);

p.command("unset-default-workspace")
  .description("Remove the saved default workspace from ~/.jitsu/jitsu-cli.json")
  .action(unsetDefaultWorkspace);

p.addCommand(buildConfigCommand());
p.addCommand(buildSpecCommand());

p.version(jitsuCliPackageName + " " + jitsuCliVersion, "-v, --version");
p.helpOption("--help", "display help for command");

p.parse();
