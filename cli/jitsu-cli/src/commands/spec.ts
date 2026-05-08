import { Command } from "commander";
import { red } from "../lib/chalk-code-highlight";
import { resolveAuth } from "../lib/auth-file";
import { fetchSpec } from "../lib/spec";
import { DEFAULT_OUTPUT, SUPPORTED_OUTPUTS, print } from "../lib/renderer";

export function buildSpecCommand(): Command {
  return new Command("spec")
    .description("Print the live OpenAPI spec served at /api/spec")
    .option(
      "-o, --output <format>",
      `Output format: ${SUPPORTED_OUTPUTS.join(", ")}`,
      DEFAULT_OUTPUT
    )
    .option("-h, --host <host>", "Jitsu host (overrides ~/.jitsu/jitsu-cli.json)")
    .option("-k, --apikey <api-key>", "API key (overrides ~/.jitsu/jitsu-cli.json)")
    .action(async (opts: { output?: string; host?: string; apikey?: string }) => {
      try {
        // Pass a placeholder apikey if missing — /api/spec is public, but resolveAuth
        // expects an apikey. Fall back to a synthetic one if user has no auth file.
        const auth = (() => {
          try {
            return resolveAuth(opts);
          } catch {
            return { host: opts.host ?? "https://use.jitsu.com", apikey: "anonymous" };
          }
        })();
        const spec = await fetchSpec(auth);
        print(spec, opts.output);
      } catch (e) {
        console.error(red(`Error: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }
    });
}
