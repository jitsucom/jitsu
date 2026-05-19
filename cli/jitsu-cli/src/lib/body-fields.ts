// Pre-extracts body field flags from process.argv before Commander parses it.
//
// Why: we want users to write `--credentials.password=secret` and `--destinationType=postgres`
// as ad-hoc body fields, but Commander would reject unknown options. The simplest robust
// solution is to filter argv: anything matching `--<name>=<value>` whose head segment is NOT
// a reserved Commander option is captured here, and the rest is left for Commander.
//
// Single global stash is fine because the CLI runs one command per process.

// Reserved option names — any `--name=value` whose head is in this set is left for Commander.
// Everything else becomes a body field (top-level for flat names, nested for dotted ones).
const RESERVED = new Set([
  "workspace",
  "output",
  "host",
  "apikey",
  "file",
  "json",
  "cascade",
  "strict",
  "from",
  "to",
  "help",
  "version",
]);

const fields: Record<string, string> = {};

// Activate body-field extraction only for the `config` command group. Otherwise the
// preprocessor would steal flags from `deploy --type=function --name=foo` etc.
function shouldExtract(argv: string[]): boolean {
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("-")) continue;
    return a === "config";
  }
  return false;
}

export function preprocessArgv(argv: string[]): string[] {
  if (!shouldExtract(argv)) return argv;
  const out: string[] = [];
  for (const arg of argv) {
    const m = /^--([a-zA-Z][\w.-]*)=([\s\S]*)$/.exec(arg);
    if (m) {
      const head = m[1].split(".")[0];
      if (!RESERVED.has(head)) {
        fields[m[1]] = m[2];
        continue;
      }
    }
    out.push(arg);
  }
  return out;
}

export function consumeBodyFields(): Record<string, string> {
  const copy = { ...fields };
  for (const k of Object.keys(fields)) delete fields[k];
  return copy;
}
