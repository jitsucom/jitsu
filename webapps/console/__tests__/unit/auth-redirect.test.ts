import { describe, expect, it } from "vitest";
import { isLocalCliRedirect, isLocalPath, validateReturnUrl } from "../../lib/auth-redirect";

describe("isLocalCliRedirect", () => {
  it("accepts the local callback server of jitsu-cli", () => {
    expect(isLocalCliRedirect("http://localhost:1234/")).toBe(true);
    expect(isLocalCliRedirect("http://localhost:51234/callback")).toBe(true);
  });

  it("rejects a localhost url smuggled into the fragment or query of another host", () => {
    expect(isLocalCliRedirect("https://evil.example/#http://localhost:1234/")).toBe(false);
    expect(isLocalCliRedirect("https://evil.example/?next=http://localhost:1234/")).toBe(false);
    expect(isLocalCliRedirect("https://evil.example/http://localhost:1234/")).toBe(false);
  });

  it("rejects hosts that only start with localhost or carry credentials", () => {
    expect(isLocalCliRedirect("http://localhost:1234@evil.example/")).toBe(false);
    expect(isLocalCliRedirect("http://localhost.evil.example:1234/")).toBe(false);
    expect(isLocalCliRedirect("http://localhost:1234.evil.example/")).toBe(false);
  });

  it("rejects redirects that could change the target once a query is appended", () => {
    expect(isLocalCliRedirect("http://localhost:1234/#frag")).toBe(false);
    expect(isLocalCliRedirect("http://localhost:1234/?a=b")).toBe(false);
    expect(isLocalCliRedirect("http://localhost:1234/\\evil.example")).toBe(false);
  });

  it("rejects empty and non-http values", () => {
    expect(isLocalCliRedirect("")).toBe(false);
    expect(isLocalCliRedirect("https://localhost:1234/")).toBe(false);
    expect(isLocalCliRedirect("javascript:alert(1)")).toBe(false);
  });
});

// A return URL is put in a redirect. Browsers read a backslash as a slash and drop tabs and newlines from a URL, so
// "/\\evil.example" and "/<tab>/evil.example" are the same as "//evil.example": another host.
describe("isLocalPath", () => {
  it("accepts paths on this origin, with a query or a fragment", () => {
    for (const path of ["/", "/workspace1", "/workspace1/syncs?id=a&b=c", "/a/b/c#frag", "/a%2Fb", "/with space/x"]) {
      expect(isLocalPath(path), path).toBe(true);
    }
  });

  it("rejects what a browser reads as another host", () => {
    const attacks = [
      "//evil.example",
      "//evil.example/path",
      "/\\evil.example",
      "/\\\\evil.example",
      "/\\/evil.example",
      "//\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      "/\t\\evil.example",
      "/\u0000/evil.example",
      "/\u001f/evil.example",
      "/\u007f/evil.example",
    ];
    for (const url of attacks) {
      expect(isLocalPath(url), JSON.stringify(url)).toBe(false);
    }
  });

  it("rejects absolute and scheme urls, and anything that does not start with a slash", () => {
    for (const url of [
      "",
      "https://evil.example",
      "http://localhost:3000/",
      "javascript:alert(1)",
      "evil.example",
      " /x",
      "x/y",
    ]) {
      expect(isLocalPath(url), JSON.stringify(url)).toBe(false);
    }
  });
});

describe("isLocalPath against the URL parser", () => {
  const base = "https://console.example";

  it("the attack is real: a parser resolves these to another host", () => {
    expect(new URL("/\\evil.example", base).host).toBe("evil.example");
    expect(new URL("/\t/evil.example", base).host).toBe("evil.example");
    expect(new URL("//evil.example", base).host).toBe("evil.example");
  });

  it("whatever it accepts resolves to this origin: every path of the form /xy and /xyz over ASCII", () => {
    const chars = Array.from({ length: 128 }, (_, i) => String.fromCharCode(i));
    let accepted = 0;
    for (const a of chars) {
      for (const b of chars) {
        for (const url of [`/${a}${b}`, `/${a}${b}x`, `/x${a}${b}`]) {
          if (isLocalPath(url)) {
            accepted++;
            expect(new URL(url, base).origin, JSON.stringify(url)).toBe(base);
          }
        }
      }
    }
    // it is not a rule that rejects everything
    expect(accepted).toBeGreaterThan(10000);
  });
});

describe("validateReturnUrl", () => {
  it("returns a path on this origin as it is", () => {
    expect(validateReturnUrl("/workspace1/syncs?id=a")).toBe("/workspace1/syncs?id=a");
    expect(validateReturnUrl("/")).toBe("/");
  });

  it("sends the auth pages to the root", () => {
    expect(validateReturnUrl("/signin")).toBe("/");
    expect(validateReturnUrl("/signup?x=1")).toBe("/");
    expect(validateReturnUrl("/reset-password")).toBe("/");
  });

  it("drops a url that could leave the origin", () => {
    for (const url of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "https://evil.example",
      "",
    ]) {
      expect(validateReturnUrl(url), JSON.stringify(url)).toBeUndefined();
    }
  });
});
