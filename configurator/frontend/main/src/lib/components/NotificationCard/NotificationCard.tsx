import { Card, Typography } from "antd"
import styles from "./NotificationCard.module.less"

type NotificationCardProps = {
  title?: string | React.ReactNode
  message: string
  size?: "small" | "default"
  icon?: React.ReactNode
  onClick?: () => void
}

export const NotificationCard: React.FC<NotificationCardProps> = ({
  title,
  message,
  size = "small",
  icon,
  onClick,
}) => {
  return (
    <button className={`w-full ${styles.card}`} onClick={onClick}>
      <Card title={<NotificationTitle title={title} icon={icon} />} size={size} bordered={false}>
        <Card.Meta description={message} />
      </Card>
    </button>
  )
}

type NotificationTitleProps = {
  title: string | React.ReactNode
  icon?: React.ReactNode
  time?: Date
  size?: "small" | "default"
}

const ELLIPSIS_SUFFIX_LENGTH = 5

const NotificationTitle: React.FC<NotificationTitleProps> = ({ title, icon, time, size = "small" }) => {
  const parsedTitle =
    typeof title === "string"
      ? {
          start: title.slice(0, title.length - ELLIPSIS_SUFFIX_LENGTH),
          end: title.slice(-ELLIPSIS_SUFFIX_LENGTH),
        }
      : null
  return (
    <div className="flex items-center mt-1.5 w-full">
      {icon && <div className="flex justify-center items-center flex-initial flex-shrink-0 mr-2.5">{icon}</div>}
      {typeof title === "string" ? (
        <Typography.Text
          className={`flex-1 text-left min-w-0
            text-${size === "small" ? "sm" : "base"}`}
          ellipsis={{
            suffix: parsedTitle.end,
          }}
        >
          {parsedTitle.start}
        </Typography.Text>
      ) : (
        title
      )}
      {time && <time className="block flex-initial flex-shrink-0">{time}</time>}
    </div>
  )
}
