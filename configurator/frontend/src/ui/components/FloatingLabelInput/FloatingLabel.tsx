// @Libs
import { memo } from "react"
import cn from "classnames"
// @Types
import { SizeType } from "antd/lib/config-provider/SizeContext"
// @Styles
import "./FloatingLabel.less"

export interface Props {
  className?: string
  htmlFor: string
  render: React.ReactNode
  size?: SizeType
  hasValue?: boolean
}

const FloatingLabelComponent = ({ className, htmlFor, render, hasValue, size }: Props) => {
  return (
    <label
      className={cn("floating-label", className, hasValue && "floating-label_active", {
        "floating-label-large": size === "large",
      })}
      htmlFor={htmlFor}
    >
      {render}
    </label>
  )
}

FloatingLabelComponent.displayName = "FloatingLabel"

export const FloatingLabel = memo(FloatingLabelComponent)
