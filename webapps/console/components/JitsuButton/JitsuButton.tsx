import type { ButtonProps } from "antd/es/button/button";
import { Button } from "antd";
import omit from "lodash/omit";

import React from "react";
import { ButtonLabel } from "../ButtonLabel/ButtonLabel";
import { useRouter } from "next/router";
import { useWorkspace } from "../../lib/context";

export type JitsuButtonProps = ButtonProps & {
  iconPosition?: "left" | "right";
  //set to true if href is relative workspace link
  ws?: boolean;
};

export const WJitsuButton: React.FC<JitsuButtonProps & Required<Pick<ButtonProps, "href">>> = p => {
  const workspace = useWorkspace();
  const router = useRouter();
  return <Button0 {...p} onClick={() => router.push(`/${workspace.slug || workspace.id}${p.href}`)} />;
};

//href button
const HJitsuButton: React.FC<JitsuButtonProps & Required<Pick<ButtonProps, "href">>> = p => {
  const router = useRouter();
  return <Button0 {...p} onClick={() => router.push(p.href)} />;
};

function Button0(props: JitsuButtonProps) {
  return (
    <Button {...omit(props, "href", "children", "icon", "iconPosition")} className={"pr-1"}>
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
  return <HJitsuButton {...p} href={p.href} />;
};
