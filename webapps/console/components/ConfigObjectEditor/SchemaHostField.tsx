import { Input, Space } from "antd";
import React from "react";
import { CustomWidgetProps } from "./Editors";

export const HTTPS_PREFIX = "https://";
const HTTPS_PREFIX_REGEX = new RegExp(`^${HTTPS_PREFIX}`, "i");

export function hostToDomain(host?: string): string {
  return host?.replace(HTTPS_PREFIX_REGEX, "") ?? "";
}

export function domainToHost(domain: string): string {
  return domain ? `${HTTPS_PREFIX}${domain}` : "";
}

export const SchemaHostField: React.FC<CustomWidgetProps<string>> = props => (
  <Space.Compact block>
    <Space.Addon disabled={props.disabled}>{HTTPS_PREFIX}</Space.Addon>
    <Input
      disabled={props.disabled}
      type="text"
      value={hostToDomain(props.value)}
      onChange={event => props.onChange(domainToHost(event.target.value))}
    />
  </Space.Compact>
);
