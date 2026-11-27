import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { loggableUrl } from "../../lib/server/loggable-url";

describe("loggableUrl", () => {
  it.each([
    ["/api/workspace?__unsafe_token=key:secret", "/api/workspace"],
    ["/api/a/b?x=1&__unsafe_token=key:secret#frag", "/api/a/b"],
    ["/api/a#frag", "/api/a"],
    ["/api/plain", "/api/plain"],
    ["/api/trailing?", "/api/trailing"],
    ["", ""],
  ])("%s -> %s", (input, expected) => {
    expect(loggableUrl(input)).toBe(expected);
  });

  it("returns an empty string for a missing url", () => {
    expect(loggableUrl(undefined)).toBe("");
  });
});

// The helper only helps if it is used: a request URL put into a log line or an
// error message as is carries the query string, and with it `__unsafe_token`.
describe("request URLs in logs and errors", () => {
  const read = (file: string) => readFileSync(join(__dirname, "../../lib", file), "utf8");

  it("api.ts never interpolates req.url as is", () => {
    const source = read("api.ts");
    expect(source.match(/\$\{req\.url\}/g) ?? []).toEqual([]);
    expect(source.match(/\$\{loggableUrl\(req\.url\)\}/g)?.length).toBeGreaterThanOrEqual(10);
  });

  it("the firebase auth-failure log context never interpolates req.url as is", () => {
    const source = read("server/firebase-server.ts");
    expect(source.match(/\$\{req\.url\}/g) ?? []).toEqual([]);
    expect(source).toContain("path=${loggableUrl(req.url)}");
  });
});
