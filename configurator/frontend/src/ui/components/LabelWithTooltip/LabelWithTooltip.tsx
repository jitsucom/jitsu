// @Libs
import React, { memo } from "react"
import { Tooltip } from "antd"
import cn from "classnames"
// @Icons
import QuestionCircleOutlined from "@ant-design/icons/lib/icons/QuestionCircleOutlined"

export interface Props {
  //deprecated, use children
  render?: React.ReactNode
  children?: React.ReactNode
  documentation: React.ReactNode
  className?: string
}

const LabelWithTooltipComponent = ({ children, render, documentation, className }: Props) => (
  <span className={cn("label-with-tooltip flex flex-nowrap items-center", className)}>
    <span style={{paddingRight: '0.25rem'}}>{children || render}</span>
    <Tooltip title={documentation}>
      <QuestionCircleOutlined className="label-with-tooltip_question-mark" />
    </Tooltip>
  </span>
)

LabelWithTooltipComponent.displayName = "LabelWithTooltip"

export const LabelWithTooltip = memo(LabelWithTooltipComponent)
