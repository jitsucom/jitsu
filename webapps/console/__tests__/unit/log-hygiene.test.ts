import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { findSecretsInLogCalls } from "../support/log-hygiene";

// JITSU-302: no log call may be handed a credential. The checker is tested on snippets first, then run over the code.

const names = (code: string, extra: string[] = []) => findSecretsInLogCalls(code, "x.ts", extra).map(f => f.name);

describe("the checker finds a credential in the arguments of a log call", () => {
  it.each([
    ['log.atInfo().log("x", tokens)', "tokens"],
    ['log.atWarn().withCause(e).log("x", { token })', "token"],
    ['log.atError().log("x", JSON.stringify(req.cookies))', "cookies"],
    ["log.atDebug().log(`key ${secretKey}`)", "secretKey"],
    ["console.error(`bad ${hash}`, password)", "password"],
    ['getLog("a").atInfo().log("x", { a: tokens.id_token })', "id_token"],
    ['log.atInfo().log("x", { sasl: opts.sasl })', "sasl"],
    ['log.atDebug().log("x", JSON.stringify(userInfo))', "userInfo"],
    ['logger.atInfo().log("x", ...[csrfToken])', "csrfToken"],
    ['log.atInfo().log("x", ok ? token : "none")', "token"],
    ["log.atInfo().log(`Query: ${query}${processedParams}`)", "processedParams"],
    // the cause of a chained withCause is printed with its stack, so its arguments are looked at like the arguments of log
    ['log.atError().withCause(new Error(token)).log("request failed")', "token"],
    ['log.atError().withCause(new Error(`bad ${password}`)).log("request failed")', "password"],
    ['log.atWarn().withCause(wrap(refreshToken)).log("x")', "refreshToken"],
    // a literal index is a property name: req.headers["authorization"] is the Authorization header
    ['console.error(req.headers["authorization"])', "authorization"],
    ["console.error(req.headers['authorization'])", "authorization"],
    ['log.atInfo().log("x", user["password"])', "password"],
    ["log.atInfo().log(`got ${body[`token`]}`)", "token"],
    ['log.atInfo().log("x", cookies[name])', "cookies"],
  ])("%s", (code, name) => {
    expect(names(code)).toContain(name);
  });
});

// The policy, written out: these names are credentials wherever they appear in a log call. Removing one from the checker must
// fail here, so the list cannot shrink unnoticed.
const MUST_BE_FLAGGED = [
  "token",
  "tokens",
  "accessToken",
  "refreshToken",
  "idToken",
  "newToken",
  "secret",
  "secretKey",
  "password",
  "passwd",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "sasl",
  "authorization",
  "processedParams",
  "userInfo",
  "apiKey",
  "privateKey",
  "csrfCookie",
  "csrfToken",
  "currentUser",
];

describe("the names the checker must always flag", () => {
  it.each(MUST_BE_FLAGGED)("%s", name => {
    expect(names(`log.atInfo().log("x", ${name})`)).toContain(name);
  });

  it.each(["access_token", "refresh_token", "id_token", "ACCESS_TOKEN", "api-key", "API_KEY", "private_key"])(
    "%s, in snake or upper case, is the same name",
    name => {
      expect(names(`log.atInfo().log("x", { a: x.${name.replace(/-/g, "_")} })`)).toHaveLength(1);
    }
  );
});

describe("the checker leaves alone what cannot carry a secret", () => {
  it.each([
    'log.atInfo().log("the token is missing")',
    "log.atInfo().log(`Exchanging code for tokens`)",
    'log.atInfo().log("x", { idToken: !!tokens.id_token })',
    'log.atInfo().log("x", { expiresIn: tokens.expires_in })',
    'log.atInfo().log("x", { claims: Object.keys(userInfo).join(",") })',
    'log.atInfo().log("x", { has: Boolean(password), kind: typeof token, n: cookies.length })',
    'log.atInfo().log("x", { mechanism: opts.sasl?.mechanism })',
    'log.atInfo().log(`cookie ${csrfCookie ? "present" : "missing"}`)',
    'log.atInfo().log("x", token ? "set" : "unset")',
    "notALogger.push(token)",
    "something.log(token)",
    "console.log(`${a} ${b}`)",
    // a cause that is a plain error variable, a message about a token, and indexes that are not credential names
    'log.atError().withCause(err).log("request failed")',
    'log.atError().withCause(new Error("token expired")).log("x")',
    'log.atError().withCause(new Error(`failed for ${workspaceId}`)).log("x")',
    'console.error(req.headers["x-request-id"])',
    'log.atInfo().log("x", { n: tokens["expires_in"] })',
    'log.atInfo().log("x", !!user["password"])',
  ])("%s", code => {
    expect(names(code)).toEqual([]);
  });

  it("denies the extra names given for one file", () => {
    expect(names('log.atInfo().log("x", user)')).toEqual([]);
    expect(names('log.atInfo().log("x", user)', ["user"])).toEqual(["user"]);
  });

  it("reports the line of the call", () => {
    const found = findSecretsInLogCalls('const a = 1;\n\nlog.atInfo().log("x", tokens);', "x.ts");
    expect(found).toMatchObject([{ line: 3, name: "tokens" }]);
  });
});

// The code. Where a log call legitimately names one of these, it goes here with the reason: the list starts empty on purpose.
const ALLOWED: Record<string, string> = {};

const root = path.resolve(__dirname, "../../../..");
const SCAN = [
  "webapps/console/lib",
  "webapps/console/pages",
  "webapps/console/components",
  "services/rotor/src",
  "libs/juava/src",
  "libs/core-functions-lib/src",
  "libs/destination-functions/src",
];
// a browser file that logs a Firebase user object holds tokens under any name
const EXTRA_DENIED: Record<string, string[]> = { "webapps/console/lib/firebase-client.tsx": ["user"] };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (entry === "node_modules" || entry === "dist" || entry === ".next") return [];
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.|\.d\.ts$/.test(entry) ? [full] : [];
  });
}

describe("the code", () => {
  const all = SCAN.flatMap(d => files(path.join(root, d)));

  it("scans the code it is meant to scan", () => {
    expect(all.length).toBeGreaterThan(300);
    expect(all.some(f => f.endsWith("pages/api/auth/dynamic-oidc/callback.ts"))).toBe(true);
    expect(all.some(f => f.endsWith("services/rotor/src/lib/db.ts"))).toBe(true);
  });

  it("hands no credential to a log call", () => {
    const problems: string[] = [];
    for (const file of all) {
      const rel = path.relative(root, file);
      if (ALLOWED[rel]) continue;
      for (const f of findSecretsInLogCalls(readFileSync(file, "utf8"), file, EXTRA_DENIED[rel] ?? [])) {
        problems.push(`${rel}:${f.line} passes "${f.name}" to a log call: ${f.call}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
