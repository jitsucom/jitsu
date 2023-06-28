import { Tooltip } from "antd";
import { trimEnd, trimMiddle } from "../../lib/shared/strings";

export type LabelEllipsisProps = {
  maxLen: number;
  trim?: "middle" | "end";
  children: string;
};

export function LabelEllipsis({ maxLen, children, trim = "middle" }: LabelEllipsisProps) {
  if (children.length <= maxLen) {
    return <>{children}</>;
  } else {
    return (
      <Tooltip overlay={children}>
        {trim === "middle" ? trimMiddle(children, maxLen) : trimEnd(children, maxLen)}
      </Tooltip>
    );
  }
}
