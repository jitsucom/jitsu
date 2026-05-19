/**
 * Expand `$VAR` / `${VAR}` placeholders in a string against `process.env`.
 *
 * .env loading itself is handled by Node's `--env-file-if-exists` flag set
 * via `node-options` in the root .npmrc — see CONTRIBUTING.md. By the time
 * any dev-script runs, the layered env is already in `process.env`.
 */
export function expandEnvPlaceholders(input: string): string {
  return input.replace(/\$([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, a, b) => {
    const name = a ?? b;
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`Environment variable $${name} referenced in URL is not set`);
    }
    return value;
  });
}
