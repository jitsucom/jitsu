import figlet from "figlet";
import { Command } from "commander";
import { login } from "./commands/login";

//console.log(figlet.textSync("Jitsu CLI", { font: "ANSI Regular", horizontalLayout: "full" }));

const p = new Command();

p.name("jitsu-cli").description("CLI command to create, test and deploy extensions for Jitsu Next");

p.command("init")
  .description("Initialize a new Jitsu extension project in current directory")
  .option(
    "-n, --name <name>",
    "the name of the project. (Optional). By default, interactive prompt is shown to enter the name."
  )
  .action(options => {
    console.log("init", options);
  });

p.command("build")
  .description("Build the extension")
  .action(options => {
    console.log("build", options);
  });

p.command("test")
  .description("Run test provided with the extension")
  .action(options => {
    console.log("build", options);
  });

p.command("run")
  .description("Check extensions on provided event, config and persistent storage state")
  .option(
    "-n, --name <name>",
    "name of function to check (optional). Required if multiple functions are defined in project"
  )
  .option("-t, --type <type>", "entity type to run", "function")
  .requiredOption("-e, --event <file_or_json>", "path to file with event json or event json as a string")
  .option("-p, --props <file_or_json>", "path to file with config json or config json as a string (optional)")
  .option("-s, --store <file_or_json>", "path to file with state json or state json as a string (optional)")
  .action(options => {
    console.log("run", options);
  });

p.command("login")
  .description("Login to Jitsu and remember credentials in `~/.jitsu/jitsu-cli.json` file")
  .option("--host <host>", "Jitsu host or base url", "https://use.jitsu.com")
  .option("-k, --apikey <api-key>", "Jitsu user's Api Key (optional). Disables interactive login.")
  .action(login);

p.command("deploy")
  .description("Deploy functions to Jitsu project")
  .option(
    "-w, --workspace <workspace-id>",
    "Id of workspace where to deploy function (Optional). By default, interactive prompt is shown to select workspace"
  )
  .option("-t, --type <type>", "entity type to deploy", "function")
  .action(login);

p.parse();
