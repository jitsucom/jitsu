// @Libs
import React from "react"
import { Empty, Badge } from "antd"
import { observer } from "mobx-react-lite"
// @Store
import { inAppNotificationsStore, NotificationData } from "stores/inAppNotifications"
// @Icons
import { ExclamationCircleFilled } from "@ant-design/icons"
// @Components
import { NotificationCard } from "../NotificationCard/NotificationCard"
// @Styles
import styles from "./Notifications.module.less"
import { useHistory } from "react-router-dom"

const makeIcon = (notificationType: NotificationData["type"], notificationIcon?: React.ReactNode): React.ReactNode => {
  const badge = makeBadgeByNotificationType(notificationType)
  return notificationIcon ? makeIconWithBadge(notificationIcon, badge) : badge
}

const makeBadgeByNotificationType = (type: NotificationData["type"]): React.ReactNode => {
  switch (type) {
    case "danger":
      return <ExclamationCircleFilled className={styles.dangerIcon} />
    default:
      return undefined
  }
}

const makeIconWithBadge = (icon: React.ReactNode, badge: React.ReactNode): React.ReactNode => {
  return (
    <Badge count={badge} size="small">
      <div className="h-5 w-5">{icon}</div>
    </Badge>
  )
}

type NotificationsProps = {
  handleCloseContainer?: () => void | Promise<void>
}

const NotificationsComponent: React.FC<NotificationsProps> = ({ handleCloseContainer }) => {
  const history = useHistory()
  const notifications = inAppNotificationsStore.notifications
  return (
    <div className="h-full">
      {notifications.length ? (
        <>
          {notifications.map(({ id, title, message, type, icon, editEntityRoute }) => (
            <div key={id} className="my-2 w-full">
              <NotificationCard
                title={title}
                message={message}
                icon={makeIcon(type, icon)}
                onClick={() => {
                  handleCloseContainer?.()
                  history.push(editEntityRoute)
                }}
              />
            </div>
          ))}
        </>
      ) : (
        <div>
          <Empty description={`Notifications list is empty`} />
        </div>
      )}
    </div>
  )
}

const Notifications = observer(NotificationsComponent)

Notifications.displayName = "Notifications"

export { Notifications }
