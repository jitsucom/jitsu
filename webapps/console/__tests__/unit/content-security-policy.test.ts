import { describe, expect, it } from "vitest";
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
  it("is only the three directives that cost nothing", () => {
    expect(directives(enforcedPolicy)).toEqual({
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "frame-ancestors": ["'none'"],
    });
  });
});
