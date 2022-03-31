import { ThunderboltFilled } from "@ant-design/icons"
import { Button, ButtonProps } from "antd"
import { EventType } from "lib/components/EventsStream/shared"
import { projectRoute } from "lib/components/ProjectLink/ProjectLink"
import { useCallback } from "react"
import { useHistory } from "react-router-dom"
import { withQueryParams } from "utils/queryParams"

type LiveEventsRedirectButtonProps = {
  eventType: typeof EventType[keyof typeof EventType]
  entityId: string
} & ButtonProps

export const LiveEventsRedirectButton: React.FC<LiveEventsRedirectButtonProps> = ({
  eventType,
  entityId,
  ...buttonProps
}) => {
  const history = useHistory()

  const handleClick = useCallback<VoidFunction>(() => {
    history.push(withQueryParams(projectRoute("/events-stream"), { type: eventType, id: entityId }))
  }, [eventType, entityId])

  return (
    <Button icon={<ThunderboltFilled />} {...buttonProps} onClick={handleClick}>
      {buttonProps.children ?? "Live Events"}
    </Button>
  )
}
