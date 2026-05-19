import * as fs from "fs";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";

export type AuthInfo = { host: string; apikey: string };

export type AuthFile = {
  host?: string;
  apikey?: string;
  defaultWorkspace?: string;
};

const DEFAULT_HOST = "https://use.jitsu.com";

export function authFilePath(): string {
  return `${homedir()}/.jitsu/jitsu-cli.json`;
}

export function readAuthFile(): AuthFile | undefined {
  const path = authFilePath();
  if (!fs.existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, { encoding: "utf-8" }));
}

// Merge `patch` into the existing auth file, creating the file (and parent dir)
// if necessary. Setting a field to `undefined` removes it.
export function updateAuthFile(patch: Partial<AuthFile>): AuthFile {
  const path = authFilePath();
  const existing = readAuthFile() ?? {};
  const next: AuthFile = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete (next as any)[k];
    else (next as any)[k] = v;
  }
  mkdirSync(`${homedir()}/.jitsu`, { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2));
  return next;
}

export function readDefaultWorkspace(): string | undefined {
  return readAuthFile()?.defaultWorkspace;
}

// Resolve host + apikey for an authenticated CLI command. Order of precedence:
//   1. --host / --apikey flags
//   2. ~/.jitsu/jitsu-cli.json
//   3. JITSU_HOST / JITSU_APIKEY env vars
//   4. https://use.jitsu.com (host only)
export function resolveAuth(opts: { host?: string; apikey?: string }): AuthInfo {
  let host = opts.host;
  let apikey = opts.apikey;

  if (!host || !apikey) {
    const file = readAuthFile();
    if (file) {
      if (!host) host = file.host;
      if (!apikey) apikey = file.apikey;
    }
  }

  if (!host) host = process.env.JITSU_HOST;
  if (!apikey) apikey = process.env.JITSU_APIKEY;
  if (!host) host = DEFAULT_HOST;

  if (!apikey) {
    throw new Error("Not authenticated. Run `jitsu login`, set JITSU_APIKEY, or pass --apikey <key>.");
  }

  return { host: normalizeHost(host), apikey };
}

export function normalizeHost(host: string): string {
  let url = host;
  if (!url.startsWith("http")) {
    if (url.startsWith("localhost") || /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/.test(url)) {
      url = "http://" + url;
    } else {
      url = "https://" + url;
    }
  }
  if (url.endsWith("/")) url = url.slice(0, -1);
  return url;
}
