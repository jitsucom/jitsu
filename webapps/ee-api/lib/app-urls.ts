/**
 * Parser and matcher for `JITSU_APPLICATION_URL`.
 *
 * Value is a comma-separated list of origins ee-api is allowed to serve via
 * CORS, and from which the canonical app URL (used in emails and admin pages)
 * is taken. Each entry can be:
 *
 *   - a literal origin: `use.jitsu.com`, `https://app.example.com`
 *   - a host wildcard:  `*.jitsu.localhost` matches any subdomain of
 *     `jitsu.localhost` (one level or more)
 *
 * Scheme is `https` when omitted. Trailing path is ignored.
 *
 *   JITSU_APPLICATION_URL=use.jitsu.com,*.jitsu.localhost
 */

export type AllowedOrigin =
  | { kind: "exact"; protocol: string; host: string }
  | { kind: "suffix"; protocol: string; suffix: string };

const HTTPS = "https:";
const schemeRe = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i;

function splitScheme(entry: string): { protocol: string; rest: string } {
  const m = schemeRe.exec(entry);
  if (m) {
    return { protocol: `${m[1].toLowerCase()}:`, rest: m[2] };
  }
  return { protocol: HTTPS, rest: entry };
}

export function parseAllowedOrigins(env: string | undefined): AllowedOrigin[] {
  if (!env) return [];
  const out: AllowedOrigin[] = [];
  for (const raw of env.split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const { protocol, rest } = splitScheme(trimmed);
    const host = rest.replace(/\/.*$/, "").toLowerCase();
    if (host.startsWith("*.")) {
      out.push({ kind: "suffix", protocol, suffix: host.slice(2) });
    } else {
      out.push({ kind: "exact", protocol, host });
    }
  }
  return out;
}

export function isOriginAllowed(origin: string | undefined, allowed: AllowedOrigin[]): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const protocol = url.protocol;
  const host = url.host.toLowerCase();
  for (const entry of allowed) {
    if (entry.protocol !== protocol) continue;
    if (entry.kind === "exact" && entry.host === host) return true;
    if (entry.kind === "suffix" && (host === entry.suffix || host.endsWith(`.${entry.suffix}`))) {
      return true;
    }
  }
  return false;
}

/**
 * Canonical app URL — the first non-wildcard entry from `JITSU_APPLICATION_URL`.
 * Used to build links in emails and admin pages. Returns a bare origin (no
 * trailing slash).
 */
export function getAppBaseUrl(): string {
  const env = process.env.JITSU_APPLICATION_URL;
  for (const entry of parseAllowedOrigins(env)) {
    if (entry.kind === "exact") {
      return `${entry.protocol}//${entry.host}`;
    }
  }
  throw new Error(`JITSU_APPLICATION_URL must contain at least one non-wildcard origin (got: ${JSON.stringify(env)})`);
}
