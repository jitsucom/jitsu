// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import Convert from "ansi-to-html";
import { Htmlizer } from "../../components/Htmlizer/Htmlizer";

afterEach(cleanup);

// JITSU-268: Htmlizer put function errors and connector specs from custom images straight into innerHTML.

describe("Htmlizer", () => {
  it("keeps the formatting the docs rely on", () => {
    const { container } = render(
      React.createElement(
        Htmlizer,
        null,
        `Use <b>bold</b>, <code>code</code> and <a href="https://example.com/docs" target="_blank" rel="noreferrer">a link</a><ul><li>one</li></ul>`
      )
    );
    expect(container.querySelector("b")?.textContent).toBe("bold");
    expect(container.querySelector("code")).not.toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/docs");
    expect(container.querySelector("li")?.textContent).toBe("one");
  });

  it("strips scripts, event handlers and javascript: links", () => {
    const { container } = render(
      React.createElement(
        Htmlizer,
        null,
        `<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script><a href="javascript:window.__pwned=1" onclick="window.__pwned=1">x</a><svg onload="window.__pwned=1"></svg><iframe src="https://evil.example"></iframe>`
      )
    );
    expect(container.querySelector("img, script, svg, iframe")).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror|onclick|onload|javascript:/i);
    expect((window as any).__pwned).toBeUndefined();
  });

  it("renders a function error message as text, not markup", () => {
    const convert = new Convert({ newline: true, escapeXML: true });
    const html = convert.toHtml(`boom <img src=x onerror="window.__pwned=1"> \u001b[31mred\u001b[0m`);
    const { container } = render(React.createElement(Htmlizer, null, html));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
    expect(container.querySelector("span[style]")?.textContent).toBe("red");
  });

  it("passes non-string children through", () => {
    const { container } = render(React.createElement(Htmlizer, null, React.createElement("em", null, "node")));
    expect(container.querySelector("em")?.textContent).toBe("node");
  });
});
