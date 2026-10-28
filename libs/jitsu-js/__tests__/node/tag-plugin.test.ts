import { describe, expect, it } from "vitest";
import { jsonForHtml, replaceMacro } from "../../src/destination-plugins/tag-macro";

describe("tag plugin event macro", () => {
  const evil = {
    type: "page",
    context: { campaign: { source: "</script><img src=x onerror=alert(1)>" } },
    properties: { title: "a & b \u2028 \u2029 $& $1" },
  };

  it("never emits characters that can close or open markup", () => {
    const json = jsonForHtml(evil);
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
  });

  it("round-trips to the original event", () => {
    expect(JSON.parse(jsonForHtml(evil))).toEqual(evil);
  });

  it("keeps the macro working inside a script tag without a breakout", () => {
    const html = replaceMacro(`<script>var e = {{ event }};</script>`, evil);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain("<img");
  });

  it("does not interpret $-patterns from the event as replacement tokens", () => {
    const html = replaceMacro(`{{event}}`, { a: "$& $1 $$" });
    expect(JSON.parse(html)).toEqual({ a: "$& $1 $$" });
  });
});
