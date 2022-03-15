import { FC, useEffect, useState } from "react"
import { Card, Spin } from "antd"

type Props = {
  title: string
  longLoadingMessage?: string
  showLongLoadingMessageAfterMs?: number
  className?: string
}

export const LoadableFieldsLoadingMessageCard: FC<Props> = ({
  title,
  longLoadingMessage,
  showLongLoadingMessageAfterMs,
  className,
}) => {
  const [description, setDescription] = useState<null | string>(null)

  useEffect(() => {
    let timeout
    if (true) {
      timeout = setTimeout(() => setDescription(longLoadingMessage), showLongLoadingMessageAfterMs)
    }

    return () => {
      if (timeout) clearTimeout(timeout)
    }
  }, [])

  return (
    <Card className={className}>
      <Card.Meta avatar={<Spin />} title={title} description={description} />
    </Card>
  )
}
