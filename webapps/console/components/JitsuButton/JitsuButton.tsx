import type { ButtonProps } from "antd/es/button/button";
import Link from "next/link";
import { Button } from "antd";
import omit from "lodash/omit";

import React from "react";
import { WLink } from "../Workspace/WLink";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";

export type JitsuButtonProps = ButtonProps & {
  iconPosition?: "left" | "right";
  //set to true if href is relative workspace link
  ws?: boolean;
};

export const WJitsuButton: React.FC<JitsuButtonProps & Required<Pick<ButtonProps, "href">>> = p => {
  return (
    <WLink href={p.href}>
      <Button0 {...p} />
    </WLink>
  );
};

function Button0(props: JitsuButtonProps) {
  return (
    <Button {...omit(props, "href", "children", "icon", "iconPosition")}>
      {props.icon ? (
        <ButtonLabel icon={props.icon} iconPosition={props.iconPosition} loading={!!props.loading}>
          {props.children}
        </ButtonLabel>
      ) : (
        props.children
      )}
    </Button>
  );
}

export const JitsuButton: React.FC<JitsuButtonProps> = p => {
  if (!p.href) {
    return <Button0 {...p} />;
  }
  if (p.ws) {
    return <WJitsuButton {...p} href={p.href} />;
  }
  return (
    <Link href={p.href} target={p.target}>
      <Button0 {...p} />
    </Link>
  );
};
