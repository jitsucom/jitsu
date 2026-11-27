import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { enforcedPolicy, MONACO_VS_URL, strictPolicy } from "../../lib/shared/content-security-policy";

// JITSU-268: script-src without 'unsafe-inline', so injected markup cannot run script

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split(";").map(d => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name, sources];
    })
  );

describe("strictPolicy", () => {
  const d = directives(strictPolicy);

  it("lets no inline script or eval run, and no script from an arbitrary https host", () => {
    for (const name of ["script-src", "default-src"]) {
      expect(d[name]).not.toContain("'unsafe-inline'");
      expect(d[name]).not.toContain("'unsafe-eval'");
      expect(d[name]).not.toContain("https:");
      expect(d[name]).not.toContain("*");
    }
  });

  it("allows scripts only from the console itself and three named places", () => {
    expect(d["script-src"]).toEqual([
      "'self'",
      "https://apis.google.com",
      "https://assets.calendly.com",
      `${MONACO_VS_URL}/`,
    ]);
  });

  it("allows the code editor by its exact versioned path, not the whole CDN host", () => {
    expect(MONACO_VS_URL).toMatch(/^https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@\d+\.\d+\.\d+\/min\/vs$/);
    for (const source of Object.values(d).flat()) {
      expect(source).not.toBe("https://cdn.jsdelivr.net");
    }
  });

  it("keeps the directives that block plugins, <base> and framing", () => {
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
  });
});

describe("enforcedPolicy", () => {
  // Changed from "only the three directives" (JITSU-268, script-src-attr): the enforced policy now has a fourth one. It
  // blocks inline event-handler attributes (onerror=, onclick=), the usual shape of an injected XSS payload, and costs
  // nothing: the console renders no inline handler attributes (checked on the live page: none), and React's own handlers
  // are not attributes. script-src itself stays report-only, because the console's analytics tags need inline scripts.
  it("is only the four directives that cost nothing", () => {
    expect(directives(enforcedPolicy)).toEqual({
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "frame-ancestors": ["'none'"],
      "script-src-attr": ["'none'"],
    });
  });

  it("blocks inline event-handler attributes but says nothing about script elements", () => {
    const d = directives(enforcedPolicy);
    expect(d["script-src-attr"]).toEqual(["'none'"]);
    // script-src and default-src are not enforced yet: GTM, the Meta and Twitter pixels, LogRocket and Datadog would break
    expect(d["script-src"]).toBeUndefined();
    expect(d["default-src"]).toBeUndefined();
  });
});

describe("the headers the console sends", () => {
  it("enforce enforcedPolicy and only report strictPolicy", async () => {
    const config = createRequire(import.meta.url)("../../next.config.js");
    const rules = await config.headers();
    const all = rules.flatMap((rule: { headers: { key: string; value: string }[] }) => rule.headers);
    const value = (key: string) => all.find((h: { key: string }) => h.key === key)?.value;
    expect(value("Content-Security-Policy")).toBe(enforcedPolicy);
    expect(value("Content-Security-Policy")).toContain("script-src-attr 'none'");
    expect(value("Content-Security-Policy-Report-Only")).toBe(strictPolicy);
  });
});
