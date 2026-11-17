import { afterEach, describe, expect, it } from "vitest";
import * as http from "node:http";
import { AddressInfo } from "node:net";
import {
  createGuardedFetch,
  isBlockedAddressError,
  isForbidLocalEnabled,
  parseLocalWhitelist,
} from "../src/functions/lib/guarded-fetch";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve))));
});

async function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("createGuardedFetch", () => {
  it("refuses a non-public address without reaching the server", async () => {
    let hit = false;
    const port = await listen((_, res) => ((hit = true), res.end("secret")));
    const error = await createGuardedFetch()(`http://127.0.0.1:${port}/`).catch(e => e);
    expect(isBlockedAddressError(error)).toBe(true);
    expect(hit).toBe(false);
  });

  it("reaches a host that is on the allow list", async () => {
    const port = await listen((_, res) => res.end("hello"));
    const res = await createGuardedFetch({ allowedHosts: ["localhost"] })(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("refuses a redirect from an allowed host to an internal address", async () => {
    let internalHit = false;
    const internal = await listen((_, res) => ((internalHit = true), res.end("secret")));
    const redirector = await listen((_, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${internal}/metadata` });
      res.end();
    });
    const error = await createGuardedFetch({ allowedHosts: ["localhost"] })(`http://localhost:${redirector}/`).catch(
      e => e
    );
    expect(isBlockedAddressError(error)).toBe(true);
    expect(internalHit).toBe(false);
  });
});

describe("parseLocalWhitelist", () => {
  it("is empty without a value", () => {
    expect(parseLocalWhitelist(undefined)).toEqual([]);
    expect(parseLocalWhitelist("")).toEqual([]);
  });

  it("normalises entries like the guarded agent compares them", () => {
    expect(parseLocalWhitelist(" Internal.Example , [::1],::1")).toEqual(["internal.example", "::1", "::1"]);
  });
});

describe("isBlockedAddressError", () => {
  it("recognises the guard's error by its code, directly or as the cause of a fetch failure", () => {
    expect(isBlockedAddressError({ code: "EBLOCKED" })).toBe(true);
    expect(isBlockedAddressError({ message: "fetch failed", cause: { code: "EBLOCKED" } })).toBe(true);
    expect(isBlockedAddressError({ message: "fetch failed", cause: { code: "ECONNREFUSED" } })).toBe(false);
    expect(isBlockedAddressError(undefined)).toBe(false);
  });
});

// Bulker's guard reads the same variable (bulker/bulkerlib/implementations/api_based/guarded_http.go): the spellings
// that turn it on must be the same in both, or one value set for every service protects only some of them.
describe("isForbidLocalEnabled", () => {
  it.each(["true", "TRUE", " True ", "1", "yes", "on", "ON"])("turns the guard on for %j", value => {
    expect(isForbidLocalEnabled(value)).toBe(true);
  });

  it.each(["false", "0", "no", "off", "", "   ", "enabled", undefined])("leaves the guard off for %j", value => {
    expect(isForbidLocalEnabled(value)).toBe(false);
  });
});
