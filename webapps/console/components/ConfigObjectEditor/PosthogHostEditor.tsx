import React from "react";
import { Input } from "antd";
import { CustomWidgetProps } from "./Editors";
import { POSTHOG_HTTPS_PREFIX, posthogDomainToHost, posthogHostToDomain } from "../../lib/schema/posthog-host";

export const PosthogHostEditor: React.FC<CustomWidgetProps<string>> = props => (
  <Input
    addonBefore={POSTHOG_HTTPS_PREFIX}
    disabled={props.disabled}
    type="text"
    value={posthogHostToDomain(props.value)}
    onChange={event => props.onChange(posthogDomainToHost(event.target.value))}
  />
);
