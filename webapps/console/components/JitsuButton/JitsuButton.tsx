import { Button, Tooltip, ButtonProps } from "antd";
import omit from "lodash/omit";

import React, { forwardRef } from "react";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";
import { useRouter } from "next/router";
import { useWorkspace, useWorkspaceRole } from "../../lib/context";
import { hasPermission, WorkspacePermissionsType } from "../../lib/workspace-roles";

export type JitsuButtonProps = ButtonProps & {
  //set to true if href is relative workspace link
  ws?: boolean;
  className?: string;
  requiredPermission?: WorkspacePermissionsType;
  //if set, button will be disabled and reason will be displayed as tooltip
  disabledReason?: string;
};

type ButtonRef = HTMLButtonElement | HTMLAnchorElement;

export const WJitsuButton = forwardRef<ButtonRef, JitsuButtonProps & Required<Pick<ButtonProps, "href">>>((p, ref) => {
  const workspace = useWorkspace();
  const router = useRouter();
  return <Button0 ref={ref} {...p} onClick={() => router.push(`/${workspace.slugOrId}${p.href}`)} />;
});
WJitsuButton.displayName = "WJitsuButton";

//href button
const HJitsuButton = forwardRef<ButtonRef, JitsuButtonProps & Required<Pick<ButtonProps, "href">>>((p, ref) => {
  const router = useRouter();
  return <Button0 ref={ref} {...p} onClick={() => router.push(p.href)} />;
});
HJitsuButton.displayName = "HJitsuButton";

const Button0 = forwardRef<ButtonRef, JitsuButtonProps>((props, ref) => {
  const workspaceRole = useWorkspaceRole();
  const hasPerm = props.requiredPermission ? hasPermission(workspaceRole.role, props.requiredPermission) : true;

  // Determine tooltip message
  const tooltipTitle = props.disabledReason
    ? props.disabledReason
    : !hasPerm
    ? `You don't have permission '${props.requiredPermission}'`
    : undefined;

  // Button is disabled if explicitly disabled, no permission, or disabledReason is set
  const isDisabled = props.disabled || !hasPerm || !!props.disabledReason;

  const button = (
    <Button
      ref={ref}
      {...omit(props, "href", "children", "icon", "iconPosition", "disabledReason")}
      disabled={isDisabled}
      className={`${props.className}`}
    >
      {props.icon ? (
        <ButtonLabel icon={props.icon} iconPosition={props.iconPosition} loading={!!props.loading}>
          {props.children}
        </ButtonLabel>
      ) : (
        props.children
      )}
    </Button>
  );

  if (tooltipTitle) {
    return <Tooltip title={tooltipTitle}>{button}</Tooltip>;
  }

  return button;
});
Button0.displayName = "Button0";

export const JitsuButton = forwardRef<ButtonRef, JitsuButtonProps>((p, ref) => {
  if (!p.href) {
    return <Button0 ref={ref} {...p} />;
  }
  if (p.ws) {
    return <WJitsuButton ref={ref} {...omit(p, "ws")} href={p.href} />;
  }
  return <HJitsuButton ref={ref} {...p} href={p.href} />;
});
JitsuButton.displayName = "JitsuButton";
