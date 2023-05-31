import { Tooltip } from "antd";
import { trimMiddle } from "../../lib/shared/strings";

export type LabelEllipsisProps = {
  maxLen: number;
  children: string;
};

export function LabelEllipsis(props: LabelEllipsisProps) {
  if (props.children.length <= props.maxLen) {
    return <>{props.children}</>;
  } else {
    return <Tooltip overlay={props.children}>{trimMiddle(props.children, props.maxLen)}</Tooltip>;
  }
}
