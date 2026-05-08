import { Command } from "commander";
import { red } from "../../lib/chalk-code-highlight";
import { DEFAULT_OUTPUT, SUPPORTED_OUTPUTS } from "../../lib/renderer";
import { resources, Resource, Verb, verbsFor } from "./resources";
import { LeafOpts, runCreate, runDelete, runGet, runList, runTest, runUpdate } from "./handlers";

// Decorate a Command with the common options every leaf shares.
function withCommonOpts(cmd: Command): Command {
  return cmd
    .option("-w, --workspace <id-or-slug>", "Target workspace id or slug")
    .option("-o, --output <format>", `Output format: ${SUPPORTED_OUTPUTS.join(", ")}`, DEFAULT_OUTPUT)
    .option("-h, --host <host>", "Jitsu host (overrides ~/.jitsu/jitsu-cli.json)")
    .option("-k, --apikey <api-key>", "API key in form keyId:secret (overrides ~/.jitsu/jitsu-cli.json)");
}

function withBodyOpts(cmd: Command): Command {
  return cmd
    .option("-f, --file <path>", "Read body from yaml or json file (use `-` for stdin)")
    .option("--json <json>", "Inline JSON body")
    .addHelpText(
      "after",
      [
        "",
        "Body fields can also be set ad-hoc via --<path>=<value> flags.",
        "Examples:",
        "  --name=my-destination",
        "  --destinationType=postgres",
        "  --credentials.host=db.example.com",
        "  --credentials.password=secret",
        '  --credentials.keys=\'["a","b"]\'',
        'Values starting with [, {, " or matching number/boolean/null are parsed as JSON;',
        "everything else is a plain string. -f, --json, and --field flags merge in that order.",
      ].join("\n")
    );
}

// Wrap an async handler so any thrown error prints a red message and sets exit 1.
function action<T extends any[]>(fn: (...args: T) => Promise<void> | void) {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(red(`Error: ${msg}`));
      process.exit(1);
    }
  };
}

// Builds a leaf command for a (resource, verb) pair. The same builder is used in both
// orderings (`config <noun> <verb>` and `config <verb> <noun>`) so the surface stays
// consistent; only the parent.
function buildLeaf(resource: Resource, verb: Verb): Command {
  switch (verb) {
    case "list": {
      const cmd = withCommonOpts(new Command("list"))
        .description(`List ${resource.noun}`)
        .action(action(async (opts: LeafOpts) => runList(resource, opts)));
      return cmd;
    }
    case "get": {
      const idLabel = resource.kind === "workspace" ? "<id-or-slug>" : "<id>";
      const cmd = withCommonOpts(new Command("get"))
        .description(`Get a single ${singular(resource)} by id`)
        .argument(idLabel, `Identifier of the ${singular(resource)}`)
        .action(action(async (id: string, opts: LeafOpts) => runGet(resource, id, opts)));
      return cmd;
    }
    case "create": {
      const cmd = withBodyOpts(withCommonOpts(new Command("create")))
        .description(`Create a ${singular(resource)}`)
        .action(action(async (opts: LeafOpts) => runCreate(resource, opts)));
      return cmd;
    }
    case "update": {
      const idLabel = resource.kind === "link" ? "[id]" : "<id>";
      const idDesc =
        resource.kind === "link"
          ? `Link id (optional — connections are upserts identified by fromId+toId)`
          : `Identifier of the ${singular(resource)}`;
      const cmd = withBodyOpts(withCommonOpts(new Command("update")))
        .description(`Update a ${singular(resource)} (deep-merge into existing)`)
        .argument(idLabel, idDesc)
        .action(action(async (id: string | undefined, opts: LeafOpts) => runUpdate(resource, id, opts)));
      return cmd;
    }
    case "delete": {
      const idLabel = resource.kind === "link" ? "[id]" : "<id>";
      let cmd = withCommonOpts(new Command("delete"))
        .alias("rm")
        .description(`Delete a ${singular(resource)}`)
        .argument(idLabel, `Identifier of the ${singular(resource)}`);
      if (resource.kind === "configObject") {
        cmd = cmd
          .option("--cascade", "Also delete linked connections that reference this object")
          .option("--strict", "Refuse to delete if linked connections exist");
      }
      if (resource.kind === "link") {
        cmd = cmd
          .option("--from <streamOrServiceId>", "Source id (use with --to instead of <id>)")
          .option("--to <destinationId>", "Destination id (use with --from instead of <id>)");
      }
      cmd = cmd.action(action(async (id: string | undefined, opts: LeafOpts) => runDelete(resource, id, opts)));
      return cmd;
    }
    case "test": {
      const cmd = withBodyOpts(withCommonOpts(new Command("test")))
        .description(`Test connectivity for a ${singular(resource)} configuration`)
        .action(action(async (opts: LeafOpts) => runTest(resource, opts)));
      return cmd;
    }
  }
}

function singular(r: Resource): string {
  return r.aliases[0] ?? r.noun.replace(/s$/, "");
}

export function buildConfigCommand(): Command {
  const config = new Command("config")
    .description("Manage workspace configuration objects (destinations, streams, connections, ...)")
    .addHelpText(
      "after",
      [
        "",
        "Two equivalent invocation styles are supported:",
        "  jitsu config <noun> <verb> [args]    e.g. jitsu config destinations list -w ws",
        "  jitsu config <verb> <noun> [args]    e.g. jitsu config list destinations -w ws",
        "",
        "Resources:",
        ...resources.map(r => `  ${r.noun.padEnd(20)} ${r.description}`),
      ].join("\n")
    );

  // Tree A: noun-first. `config <noun> <verb>`
  for (const resource of resources) {
    const nounCmd = new Command(resource.noun).description(resource.description);
    for (const alias of resource.aliases) nounCmd.alias(alias);
    for (const verb of verbsFor(resource.kind)) {
      nounCmd.addCommand(buildLeaf(resource, verb));
    }
    if (resource.supportsTest) {
      nounCmd.addCommand(buildLeaf(resource, "test"));
    }
    config.addCommand(nounCmd);
  }

  // Tree B: verb-first. `config <verb> <noun>`
  const allVerbs: Verb[] = ["list", "get", "create", "update", "delete", "test"];
  for (const verb of allVerbs) {
    const verbCmd = new Command(verb).description(
      `${capitalize(verb)} a configuration object (alias for the noun-first form)`
    );
    for (const resource of resources) {
      const applicable = verbsFor(resource.kind).includes(verb) || (verb === "test" && resource.supportsTest);
      if (!applicable) continue;
      const leaf = buildLeaf(resource, verb);
      // Override the leaf's name from the verb to the noun for this tree.
      leaf.name(resource.noun);
      for (const alias of resource.aliases) leaf.alias(alias);
      verbCmd.addCommand(leaf);
    }
    config.addCommand(verbCmd);
  }

  return config;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
