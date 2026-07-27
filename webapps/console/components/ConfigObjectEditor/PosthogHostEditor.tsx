import React from "react";
import { Input, Space } from "antd";
import { CustomWidgetProps } from "./Editors";
import { POSTHOG_HTTPS_PREFIX, posthogDomainToHost, posthogHostToDomain } from "../../lib/schema/posthog-host";

export const PosthogHostEditor: React.FC<CustomWidgetProps<string>> = props => (
  <Space.Compact block>
    <Space.Addon disabled={props.disabled}>{POSTHOG_HTTPS_PREFIX}</Space.Addon>
    <Input
      disabled={props.disabled}
      type="text"
      value={posthogHostToDomain(props.value)}
      onChange={event => props.onChange(posthogDomainToHost(event.target.value))}
    />
  </Space.Compact>
);
