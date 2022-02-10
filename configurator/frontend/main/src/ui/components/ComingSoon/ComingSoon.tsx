// @Libs
import { memo } from "react"
import { Tooltip } from "antd"

export interface Props {
  render: React.ReactNode
  documentation: React.ReactNode
}

const ComingSoonComponent = ({ render, documentation }: Props) => (
  <Tooltip title={documentation}>
    {render}

    <sup>
      <i>Coming Soon!</i>
    </sup>
  </Tooltip>
)

ComingSoonComponent.displayName = "ComingSoon"

export const ComingSoon = memo(ComingSoonComponent)
