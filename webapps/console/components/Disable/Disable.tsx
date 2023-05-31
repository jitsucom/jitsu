import { Children, cloneElement, PropsWithChildren, ReactNode } from "react";
import { Tooltip } from "antd";

export type DisableProps =
  | {
      disabled: false;
    }
  | { disabled: true; disabledReason: ReactNode };

export const Disable: React.FC<PropsWithChildren<DisableProps>> = props => {
  const arrayChildren = Children.toArray(props.children);
  const child = arrayChildren[0];
  if (!props.disabled) {
    return <>{child}</>;
  }
  if (arrayChildren.length !== 1) {
    throw new Error(`<Disable /> must have exactly one child, found ${arrayChildren.length}`);
  }
  return <Tooltip title={<>{props.disabledReason}</>}>{cloneElement(child as any, { disabled: true })}</Tooltip>;
};
