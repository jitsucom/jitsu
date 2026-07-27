import { Space } from "antd";
import { Children, ReactElement } from "react";
import { describe, expect, test } from "vitest";
import {
  domainToHost,
  hostToDomain,
  HTTPS_PREFIX,
  SchemaHostField,
} from "../../components/ConfigObjectEditor/SchemaHostField";

describe("SchemaHostField", () => {
  test("shows only the editable domain from a persisted HTTPS host", () => {
    expect(hostToDomain("https://app.example.com")).toBe("app.example.com");
  });

  test("shows only the editable domain when the persisted HTTPS scheme uses uppercase letters", () => {
    expect(hostToDomain("HTTPS://APP.EXAMPLE.COM")).toBe("APP.EXAMPLE.COM");
  });

  test("preserves an unrecognized legacy value so the user can correct it", () => {
    expect(hostToDomain("analytics.internal")).toBe("analytics.internal");
  });

  test("stores an edited domain as a full HTTPS host", () => {
    expect(domainToHost("analytics.example.com")).toBe("https://analytics.example.com");
  });

  test("keeps an empty input empty so required validation remains visible", () => {
    expect(domainToHost("")).toBe("");
  });

  test("renders the HTTPS prefix with the supported compact addon API", () => {
    const field = SchemaHostField({
      value: "https://app.example.com",
      onChange: () => undefined,
    }) as ReactElement;
    const children = Children.toArray(field.props.children) as ReactElement[];

    expect(field.type).toBe(Space.Compact);
    expect(children[0].type).toBe(Space.Addon);
    expect(children[0].props.children).toBe(HTTPS_PREFIX);
  });
});
