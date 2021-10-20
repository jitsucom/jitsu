import { Tooltip } from "antd"

export type LabelEllipsisProps = {
  maxLen: number
  children: string
}

function trimMiddle(str: string, maxLen: number) {
  if (str.length <= maxLen) {
  } else {
    return str.substr(0, maxLen / 2 - 2) + "..." + str.substr(str.length - maxLen / 2 + 1)
  }
}

export function LabelEllipsis(props: LabelEllipsisProps) {
  if (props.children.length <= props.maxLen) {
    return <>{props.children}</>
  } else {
    return <Tooltip overlay={props.children}>{trimMiddle(props.children, props.maxLen)}</Tooltip>
  }
}
