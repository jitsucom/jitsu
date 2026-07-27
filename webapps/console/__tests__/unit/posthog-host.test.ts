import { Children, ReactElement } from "react";
import { Space } from "antd";
import { describe, expect, test } from "vitest";
import { PosthogHostEditor } from "../../components/ConfigObjectEditor/PosthogHostEditor";
import { posthogDomainToHost, posthogHostToDomain } from "../../lib/schema/posthog-host";

describe("PostHog host editor conversion", () => {
  test("shows only the editable domain from a persisted HTTPS host", () => {
    expect(posthogHostToDomain("https://app.posthog.com")).toBe("app.posthog.com");
  });

  test("shows only the editable domain when the persisted HTTPS scheme uses uppercase letters", () => {
    expect(posthogHostToDomain("HTTPS://APP.POSTHOG.COM")).toBe("APP.POSTHOG.COM");
  });

  test("preserves an unrecognized legacy value so the user can correct it", () => {
    expect(posthogHostToDomain("posthog.internal")).toBe("posthog.internal");
  });

  test("stores an edited domain as a full HTTPS host", () => {
    expect(posthogDomainToHost("analytics.example.com")).toBe("https://analytics.example.com");
  });

  test("keeps an empty input empty so required validation remains visible", () => {
    expect(posthogDomainToHost("")).toBe("");
  });

  test("renders the HTTPS prefix with the supported compact addon API", () => {
    const editor = PosthogHostEditor({
      value: "https://app.posthog.com",
      onChange: () => undefined,
    }) as ReactElement;
    const children = Children.toArray(editor.props.children) as ReactElement[];

    expect(editor.type).toBe(Space.Compact);
    expect(children[0].type).toBe(Space.Addon);
    expect(children[0].props.children).toBe("https://");
  });
});
