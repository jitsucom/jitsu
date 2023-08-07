import { Tooltip } from "antd";
import { trimEnd, trimMiddle } from "../../lib/shared/strings";

export type LabelEllipsisProps = {
  maxLen: number;
  trim?: "middle" | "end";
  children: string;
  className?: string;
};

export function LabelEllipsis({ maxLen, children, trim = "middle", className }: LabelEllipsisProps) {
  if (children.length <= maxLen) {
    return <span className={className ?? ""}>{children}</span>;
  } else {
    return (
      <Tooltip overlay={children}>
        <span className={className ?? ""}>
          {trim === "middle" ? trimMiddle(children, maxLen) : trimEnd(children, maxLen)}
        </span>
      </Tooltip>
    );
  }
}
